import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { connect } from "../supabase/functions/_shared/postgres.ts";
import { modify, readModel } from "../supabase/functions/_shared/repository.ts";
import { validateDatabase } from "../supabase/functions/_shared/legacy/server/integrity.ts";
import type { Database } from "../supabase/functions/_shared/legacy/shared/models.ts";
import { canonical, type Row } from "../supabase/functions/_shared/legacy/shared/schema.ts";

const headers = {
  proveedores: ["nit", "digito_verf", "nombre_largo", "nombre_corto", "es_maquila", "es_materiales", "activo"],
  categorias: ["nombre_categoria", "iva"],
  tipos_materiales: ["tipo_material"],
  materiales: ["codigo_maia", "tipo_material", "nombre_material"],
  productos: ["nombre_producto", "nit_maquilador", "categoria", "unidades_lote", "activo", "codigo_barras"],
} as const;
type Sheet = keyof typeof headers;
type Entry = { sheet: Sheet; index: number; data: Record<string, string> };
const sheets = Object.keys(headers) as Sheet[];
const [file, ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");
const chosen = flags.find((flag) => flag.startsWith("--tabla="))?.slice(8) as Sheet | undefined;

function text(value: string, label: string) {
  if (!value) throw new Error("Completa " + label);
  return value;
}
function int(value: string, label: string, minimum = 0) {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < minimum) throw new Error(label + " debe ser un entero válido");
  return result;
}
function bool(value: string, label: string, fallback: boolean) {
  if (!value) return fallback;
  const normal = canonical(value);
  if (["si", "true", "1"].includes(normal)) return true;
  if (["no", "false", "0"].includes(normal)) return false;
  throw new Error("Indica Sí o No en " + label);
}
function decode(sheet: Sheet, rows: string[][]) {
  const [columns, ...entries] = rows;
  if (!columns || new Set(columns).size !== columns.length || columns.length !== headers[sheet].length ||
      !headers[sheet].every((column) => columns.includes(column))) throw new Error(sheet + " requiere " + headers[sheet].join(", "));
  return entries.flatMap((cells, index): Entry[] => {
    if (!cells.some(Boolean)) return [];
    if (cells.length !== columns.length) throw new Error(sheet + " fila " + (index + 2) + " tiene columnas de más");
    return [{ sheet, index: index + 2, data: Object.fromEntries(columns.map((column, i) => [column, cells[i].trim()])) }];
  });
}

async function readEntries(path: string, buffer: Buffer) {
  if (extname(path).toLowerCase() === ".csv") {
    if (!chosen || !sheets.includes(chosen)) throw new Error("Para CSV indica --tabla=" + sheets.join("|"));
    return decode(chosen, parse(buffer, { bom: true, trim: true, skip_empty_lines: false, relax_column_count_less: false,
      delimiter: flags.includes("--punto-y-coma") ? ";" : ",", max_record_size: 16_384 }) as string[][]);
  }
  if (extname(path).toLowerCase() !== ".xlsx") throw new Error("Usa un archivo UTF-8 CSV o Excel XLSX.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  for (const sheet of workbook.worksheets) {
    if (!sheets.includes(sheet.name as Sheet)) throw new Error("Hoja desconocida: " + sheet.name);
  }
  return sheets.flatMap((name) => {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) return [];
    if (sheet.rowCount > 25000 || sheet.columnCount > headers[name].length) throw new Error(name + " excede las dimensiones admitidas.");
    const rows = [];
    for (let index = 1; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index);
      const cells = Array.from({ length: headers[name].length }, (_, i) => {
        const cell = row.getCell(i + 1);
        if (cell.value !== null && typeof cell.value !== "string" && typeof cell.value !== "number" &&
            typeof cell.value !== "boolean") throw new Error(name + "!" + cell.address + " debe contener un valor simple.");
        if (index > 1 && typeof cell.value === "number" &&
            /^(nit|codigo_|digito_verf)/.test(sheet.getRow(1).getCell(i + 1).text)) {
          throw new Error(name + "!" + cell.address + " debe ser texto para conservar sus ceros.");
        }
        return cell.text.trim();
      });
      rows.push(cells);
    }
    return decode(name, rows);
  });
}

function applyCatalog(data: Database, entries: Entry[]) {
  const seen = new Set<string>();
  const errors: { tabla: string; fila: number; error: string }[] = [];
  const counts: Record<string, number> = {};
  const record = (value: Row, label: string) => {
    if (!value) throw new Error("No se encuentra " + label);
    return value;
  };
  function upsert(list: Row[], existing: Row | undefined, key: string, values: Row) {
    if (seen.has(key)) throw new Error("Clave duplicada en el archivo: " + key);
    seen.add(key);
    if (existing) Object.assign(existing, values);
    else list.push({ id: crypto.randomUUID(), ...values });
  }
  for (const { sheet, index, data: row } of entries) {
    try {
      if (sheet === "proveedores") {
        const nit = text(row.nit, "nit");
        upsert(data.proveedor, data.proveedor.find((item) => item.nit === nit), sheet + nit, {
          nit, digito_verf: row.digito_verf || null, nombre_largo: text(row.nombre_largo, "nombre_largo"),
          nombre_corto: row.nombre_corto || null, Es_maquila: bool(row.es_maquila, "es_maquila", false),
          Es_materiales: bool(row.es_materiales, "es_materiales", false), activo: bool(row.activo, "activo", true),
        });
      } else if (sheet === "categorias") {
        const name = text(row.nombre_categoria, "nombre_categoria");
        upsert(data.categorias, data.categorias.find((item) => canonical(item.nombre_categoria ?? "") === canonical(name)), sheet + canonical(name),
          { nombre_categoria: name, iva: row.iva ? int(row.iva, "iva") : null });
      } else if (sheet === "tipos_materiales") {
        const name = text(row.tipo_material, "tipo_material");
        upsert(data.tipos_materiales, data.tipos_materiales.find((item) => canonical(item.tipo_material ?? "") === canonical(name)),
          sheet + canonical(name), { tipo_material: name });
      } else if (sheet === "materiales") {
        const type = record(data.tipos_materiales.find((item) => canonical(item.tipo_material ?? "") === canonical(row.tipo_material))!,
          "el tipo de material " + row.tipo_material);
        const name = text(row.nombre_material, "nombre_material");
        if (row.codigo_maia && !/^\d{3}$/.test(row.codigo_maia)) throw new Error("El código MAIA debe tener tres dígitos.");
        if (!row.codigo_maia && canonical(type.tipo_material) !== "corrugado") throw new Error("Completa el código MAIA.");
        const code = row.codigo_maia ? Number(row.codigo_maia) : null;
        const existing = data.materiales.find((item) => code !== null ? item.codigo_material === code :
          item.codigo_material === null && item.id_tipo_material === type.id && canonical(item.nombre_material ?? "") === canonical(name));
        upsert(data.materiales, existing, sheet + (row.codigo_maia || type.id + ":" + canonical(name)), {
          codigo_material: code, nombre_material: name, id_tipo_material: type.id,
        });
      } else {
        const maker = record(data.proveedor.find((item) => item.nit === row.nit_maquilador && item.Es_maquila === true)!, "el maquilador " + row.nit_maquilador);
        const category = record(data.categorias.find((item) => canonical(item.nombre_categoria ?? "") === canonical(row.categoria))!, "la categoría " + row.categoria);
        const name = text(row.nombre_producto, "nombre_producto");
        const existing = data.productos.find((item) => item.id_maquilador === maker.id && canonical(item.nombre_producto) === canonical(name));
        const units = int(row.unidades_lote, "unidades_lote", 1);
        const active = bool(row.activo, "activo", true);
        const barcode = row.codigo_barras ? data.codigos_barras.find((item) => item.codigo === row.codigo_barras) : undefined;
        if (barcode && barcode.id_producto !== existing?.id) throw new Error("El código de barras ya pertenece a otro producto.");
        if (row.codigo_barras && seen.has("barcode:" + row.codigo_barras)) throw new Error("Código de barras duplicado.");
        upsert(data.productos, existing, sheet + maker.id + ":" + canonical(name), {
          nombre_producto: name, id_categoria: category.id, id_maquilador: maker.id, unidades_lote: units, activo: active,
        });
        if (row.codigo_barras) {
          const product = existing ?? data.productos.at(-1)!;
          for (const item of data.codigos_barras)
            if (item.id_producto === product.id && item.estado === "asignado" && item.codigo !== row.codigo_barras) item.estado = "activo";
          const date = new Date().toISOString();
          upsert(data.codigos_barras, barcode, "barcode:" + row.codigo_barras, {
            codigo: row.codigo_barras, id_producto: product.id, estado: "asignado", fecha_creacion: barcode?.fecha_creacion ?? date, fecha_act: date,
          });
        }
      }
      counts[sheet] = (counts[sheet] ?? 0) + 1;
    } catch (error) { errors.push({ tabla: sheet, fila: index, error: (error as Error).message }); }
  }
  return { procesamiento: counts, errores: errors };
}

if (!file || !process.env.GIMED_ADMIN_DB_URL) throw new Error("Uso: npm run importar -- <archivo> [--tabla=nombre] [--punto-y-coma] [--apply]");
if ((await stat(file)).size > 8 * 1024 ** 2) throw new Error("El archivo debe pesar como máximo 8 MiB.");
const bytes = await readFile(file);
const entries = await readEntries(file, bytes);
if (!entries.length || entries.length > 25000) throw new Error("La carga debe contener de 1 a 25.000 filas.");
const fingerprint = createHash("sha256").update(JSON.stringify([chosen ?? null, flags.includes("--punto-y-coma")])).update(bytes).digest("hex");
const db = connect(process.env.GIMED_ADMIN_DB_URL);
try {
  if (!apply) {
    const model = await readModel(db);
    const report = applyCatalog(model, entries);
    if (!report.errores.length) validateDatabase(model);
    console.log(JSON.stringify(report, null, 2));
    if (report.errores.length) process.exitCode = 1;
  } else {
    const { result } = await modify(db, null, "catalogo.importar", async (model, tx) => {
      const [prior] = await tx.query<{ id: string; report: unknown }>("select id,report from gimed.catalog_import where fingerprint=$1", [fingerprint]);
      if (prior) return prior;
      const report = applyCatalog(model, entries);
      if (report.errores.length) {
        console.error(JSON.stringify(report, null, 2));
        throw new Error("La carga contiene errores. No se importaron filas.");
      }
      const [stored] = await tx.query("insert into gimed.catalog_import (fingerprint,report) values ($1,$2::text::jsonb) returning id,report",
        [fingerprint, JSON.stringify(report)]);
      return stored;
    });
    console.log(JSON.stringify(result, null, 2));
  }
} finally { await db.close(); }
