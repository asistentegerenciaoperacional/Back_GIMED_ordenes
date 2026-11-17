-- Esquema inicial generado desde el modelo revisado del prototipo.
create schema gimed;
revoke all on schema gimed from public, anon, authenticated;
create role gimed_runtime login noinherit;
grant usage on schema gimed to gimed_runtime;
create table gimed."productos" (
  "id" uuid not null,
  "nombre_producto" text not null,
  "id_maquilador" uuid not null,
  "id_categoria" uuid not null,
  "unidades_lote" bigint not null,
  "activo" boolean,
  primary key ("id")
);
create table gimed."codigos_barras" (
  "id" uuid not null,
  "codigo" text not null,
  "id_producto" uuid,
  "estado" text not null check ("estado" in ('creado_gs1', 'verificado_sistema', 'activo', 'asignado', 'inactivo')),
  "fecha_creacion" timestamptz,
  "fecha_act" timestamptz,
  primary key ("id"),
  constraint codigos_barras_uq_0 unique ("codigo") deferrable initially deferred
);
create table gimed."proveedor" (
  "id" uuid not null,
  "nombre_largo" text,
  "nombre_corto" text,
  "nit" text,
  "digito_verf" text,
  "Es_maquila" boolean,
  "Es_materiales" boolean,
  "activo" boolean,
  primary key ("id")
);
create table gimed."direccion" (
  "id" uuid not null,
  "tipo" text not null check ("tipo" in ('propia', 'proveedor')),
  "id_proveedor" uuid,
  "activa" boolean not null,
  "nombre_dir" text,
  "ciudad" text,
  "linea_1" text,
  "linea_2" text,
  primary key ("id")
);
create table gimed."usuario" (
  "id" uuid not null,
  "nombre" text not null,
  primary key ("id")
);
create table gimed."comentario" (
  "id" uuid not null,
  "id_usuario" uuid not null,
  "id_orden_producto" uuid,
  "id_orden_material" uuid,
  "texto" text not null,
  "fecha_creacion" timestamptz not null,
  primary key ("id")
);
create table gimed."contacto" (
  "id" uuid not null,
  "id_proveedor" uuid not null,
  "nombre" text,
  "celular" text,
  "cargo_area" text,
  "correo" text,
  primary key ("id")
);
create table gimed."categorias" (
  "id" uuid not null,
  "nombre_categoria" text,
  "iva" bigint,
  primary key ("id")
);
create table gimed."costos_maquila" (
  "id" uuid not null,
  "id_producto" uuid not null,
  "costo" bigint not null,
  "fecha_inicio" date not null,
  "fecha_fin" date,
  primary key ("id")
);
create table gimed."tipos_materiales" (
  "id" uuid not null,
  "tipo_material" text,
  primary key ("id"),
  constraint tipos_materiales_uq_0 unique ("tipo_material") deferrable initially deferred
);
create table gimed."materiales" (
  "id" uuid not null,
  "codigo_material" bigint,
  "id_tipo_material" uuid not null,
  "nombre_material" text,
  primary key ("id"),
  constraint materiales_uq_0 unique ("codigo_material") deferrable initially deferred
);
create table gimed."materiales_asociados" (
  "id_material" uuid not null,
  "id_producto" uuid not null,
  primary key ("id_material", "id_producto")
);
create table gimed."producto_corrugado" (
  "id_material" uuid not null,
  "id_producto" uuid not null,
  "unidades_por_corrugado" bigint not null,
  primary key ("id_producto")
);
create table gimed."proveedores_favoritos" (
  "id_tipo_material" uuid not null,
  "id_proveedor" uuid not null,
  primary key ("id_tipo_material", "id_proveedor")
);
create table gimed."orden_compra" (
  "id" uuid not null,
  "tipo_orden" text not null check ("tipo_orden" in ('producto', 'material', 'otro')),
  "no_orden" text not null,
  "id_proveedor" uuid not null,
  "fecha_elaboracion" timestamptz,
  "fecha_solicitada_entrega" date,
  "estado_autorizacion" text not null check ("estado_autorizacion" in ('no_autorizada', 'autorizada')),
  "fecha_autorizacion" timestamptz,
  primary key ("id")
);
create table gimed."orden_producto" (
  "id" uuid not null,
  "id_orden_compra" uuid not null,
  "posicion" bigint not null,
  "id_codigo_barras" uuid not null,
  "id_producto" uuid not null,
  "cantidad_solicitada" bigint not null,
  "precio_unitario" numeric(14,2) not null,
  "ref_corrugado" uuid,
  "cantidad_corrugado" bigint,
  "estado" text not null check ("estado" in ('en_seguimiento', 'anulada', 'cerrada')),
  "cantidad_sticker" bigint,
  "cantidad_cinta" bigint,
  primary key ("id"),
  constraint orden_producto_uq_0 unique ("id_orden_compra", "posicion") deferrable initially deferred
);
create table gimed."lote_producto" (
  "id" uuid not null,
  "id_orden_producto" uuid not null,
  "id_factura" uuid,
  "numero_lote" text,
  "cantidad_recibida" bigint,
  "fecha_estimada_batch_record" date,
  "fecha_entrega_batch_record" date,
  "estado_batch_record" text not null check ("estado_batch_record" in ('pendiente', 'recibido', 'validado', 'rechazado')),
  "fecha_inspeccion" date,
  "estado_inspeccion" text not null check ("estado_inspeccion" in ('pendiente', 'aprobada', 'rechazada')),
  "fecha_recepcion" date,
  "fecha_confirmacion" date,
  "id_direccion" uuid,
  "ubicacion" text,
  "estado" text not null check ("estado" in ('en_seguimiento', 'cerrado', 'anulado')),
  primary key ("id")
);
create table gimed."orden_material" (
  "id" uuid not null,
  "id_orden_compra" uuid not null,
  "posicion" bigint not null,
  "id_material" uuid not null,
  "cantidad_solicitada" bigint not null,
  "cantidad_recibida" bigint,
  "precio_unitario" numeric(14,2) not null,
  "fecha_estimada_entrega" date,
  "fecha_entrega" date,
  "id_lote_material" uuid,
  "id_factura" uuid,
  "id_direccion" uuid,
  "ubicacion" text,
  "estado" text not null check ("estado" in ('en_seguimiento', 'anulada', 'cerrada')),
  primary key ("id"),
  constraint orden_material_uq_0 unique ("id_orden_compra", "posicion") deferrable initially deferred
);
create table gimed."lote_material" (
  "id" uuid not null,
  "numero_lote" text not null,
  primary key ("id"),
  constraint lote_material_uq_0 unique ("numero_lote") deferrable initially deferred
);
create table gimed."orden_otro" (
  "id" uuid not null,
  "id_orden_compra" uuid not null,
  "posicion" bigint not null,
  "producto" text not null,
  "cantidad_solicitada" bigint not null,
  "cantidad_recibida" bigint,
  "precio_unitario" numeric(14,2) not null,
  "fecha_estimada_entrega" date,
  "fecha_entrega" date,
  "id_factura" uuid,
  "id_direccion" uuid,
  "ubicacion" text,
  "estado" text not null check ("estado" in ('en_seguimiento', 'anulada', 'cerrada')),
  primary key ("id"),
  constraint orden_otro_uq_0 unique ("id_orden_compra", "posicion") deferrable initially deferred
);
create table gimed."abastecimiento_material" (
  "id_orden_producto" uuid not null,
  "id_orden_material" uuid not null,
  primary key ("id_orden_producto", "id_orden_material")
);
create table gimed."factura" (
  "id" uuid not null,
  "id_proveedor" uuid not null,
  "numero_factura" text not null,
  "fecha_registro" timestamptz not null,
  primary key ("id"),
  constraint factura_uq_0 unique ("id_proveedor", "numero_factura") deferrable initially deferred
);
create table gimed."documento" (
  "id" uuid not null,
  "tipo_entidad" text check ("tipo_entidad" in ('factura', 'lote_material', 'orden_compra')),
  "id_entidad" uuid,
  "tipo_documento" text not null check ("tipo_documento" in ('factura_fisica', 'certificado_calidad', 'certificado_liberacion', 'orden_compra_escaneada', 'plantilla_certificado_liberacion')),
  "clave_almacenamiento" text not null,
  "nombre_archivo" text not null,
  "tipo_mime" text,
  "fecha_carga" timestamptz not null,
  primary key ("id"),
  constraint documento_uq_0 unique ("clave_almacenamiento") deferrable initially deferred,
  constraint documento_uq_1 unique ("tipo_entidad", "id_entidad", "tipo_documento") deferrable initially deferred
);
create table gimed."parametros_seguimiento" (
  "id" uuid not null,
  "margen_tolerancia_pct" numeric(5,2) not null,
  "fecha_inicio" timestamptz not null,
  primary key ("id"),
  constraint parametros_seguimiento_uq_0 unique ("fecha_inicio") deferrable initially deferred
);
create table gimed."consecutivo_orden" (
  "grupo" text not null check ("grupo" in ('producto', 'material')),
  "ultimo_numero" bigint not null,
  primary key ("grupo")
);
create table gimed."contacto_interno" (
  "id" uuid not null,
  "nombre" text not null,
  "correo" text not null,
  "cargo_area" text,
  "activo" boolean not null,
  primary key ("id")
);
create table gimed."destinatario_evento" (
  "id" uuid not null,
  "tipo_evento" text not null check ("tipo_evento" in ('codigos_barras_nuevos', 'envio_orden_compra', 'envio_certificado_calidad', 'envio_certificado_liberacion', 'cotizacion_materiales')),
  "tipo_contacto" text not null check ("tipo_contacto" in ('interno', 'proveedor')),
  "cargo_area" text not null,
  "tipo_destinatario" text not null check ("tipo_destinatario" in ('para', 'cc', 'cco')),
  primary key ("id"),
  constraint destinatario_evento_uq_0 unique ("tipo_evento", "tipo_contacto", "cargo_area") deferrable initially deferred
);
create table gimed."adjunto_evento" (
  "tipo_evento" text not null check ("tipo_evento" in ('codigos_barras_nuevos', 'envio_orden_compra', 'envio_certificado_calidad', 'envio_certificado_liberacion', 'cotizacion_materiales')),
  "tipo_adjunto" text not null check ("tipo_adjunto" in ('orden_compra_escaneada', 'certificado_calidad', 'certificado_liberacion')),
  primary key ("tipo_evento", "tipo_adjunto")
);
create table gimed."correo_enviado" (
  "id_correo" text not null,
  "remitente" text not null,
  "tipo_evento" text not null check ("tipo_evento" in ('codigos_barras_nuevos', 'envio_orden_compra', 'envio_certificado_calidad', 'envio_certificado_liberacion', 'cotizacion_materiales')),
  "fecha_envio" timestamptz not null,
  primary key ("id_correo", "remitente")
);
create table gimed."correo_enviado_destinatario" (
  "id_correo" text not null,
  "remitente" text not null,
  "destinatario" text not null,
  "tipo_destinatario" text not null check ("tipo_destinatario" in ('para', 'cc', 'cco')),
  primary key ("id_correo", "remitente", "destinatario")
);
create table gimed."plantilla_correo" (
  "tipo_evento" text not null check ("tipo_evento" in ('codigos_barras_nuevos', 'envio_orden_compra', 'envio_certificado_calidad', 'envio_certificado_liberacion', 'cotizacion_materiales')),
  "asunto" text not null,
  "cuerpo" text not null,
  primary key ("tipo_evento")
);
alter table gimed."costos_maquila" add foreign key ("id_producto") references gimed."productos" ("id") deferrable initially deferred;
create index on gimed."costos_maquila" ("id_producto");
alter table gimed."codigos_barras" add foreign key ("id_producto") references gimed."productos" ("id") deferrable initially deferred;
create index on gimed."codigos_barras" ("id_producto");
alter table gimed."productos" add foreign key ("id_maquilador") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."productos" ("id_maquilador");
alter table gimed."productos" add foreign key ("id_categoria") references gimed."categorias" ("id") deferrable initially deferred;
create index on gimed."productos" ("id_categoria");
alter table gimed."materiales_asociados" add foreign key ("id_material") references gimed."materiales" ("id") deferrable initially deferred;
alter table gimed."materiales_asociados" add foreign key ("id_producto") references gimed."productos" ("id") deferrable initially deferred;
create index on gimed."materiales_asociados" ("id_producto");
alter table gimed."producto_corrugado" add foreign key ("id_material") references gimed."materiales" ("id") deferrable initially deferred;
create index on gimed."producto_corrugado" ("id_material");
alter table gimed."producto_corrugado" add foreign key ("id_producto") references gimed."productos" ("id") deferrable initially deferred;
alter table gimed."orden_material" add foreign key ("id_material") references gimed."materiales" ("id") deferrable initially deferred;
create index on gimed."orden_material" ("id_material");
alter table gimed."materiales" add foreign key ("id_tipo_material") references gimed."tipos_materiales" ("id") deferrable initially deferred;
create index on gimed."materiales" ("id_tipo_material");
alter table gimed."contacto" add foreign key ("id_proveedor") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."contacto" ("id_proveedor");
alter table gimed."direccion" add foreign key ("id_proveedor") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."direccion" ("id_proveedor");
alter table gimed."lote_producto" add foreign key ("id_direccion") references gimed."direccion" ("id") deferrable initially deferred;
create index on gimed."lote_producto" ("id_direccion");
alter table gimed."orden_material" add foreign key ("id_direccion") references gimed."direccion" ("id") deferrable initially deferred;
create index on gimed."orden_material" ("id_direccion");
alter table gimed."orden_otro" add foreign key ("id_direccion") references gimed."direccion" ("id") deferrable initially deferred;
create index on gimed."orden_otro" ("id_direccion");
alter table gimed."comentario" add foreign key ("id_usuario") references gimed."usuario" ("id") deferrable initially deferred;
create index on gimed."comentario" ("id_usuario");
alter table gimed."comentario" add foreign key ("id_orden_producto") references gimed."orden_producto" ("id") deferrable initially deferred;
create index on gimed."comentario" ("id_orden_producto");
alter table gimed."comentario" add foreign key ("id_orden_material") references gimed."orden_material" ("id") deferrable initially deferred;
create index on gimed."comentario" ("id_orden_material");
alter table gimed."proveedores_favoritos" add foreign key ("id_proveedor") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."proveedores_favoritos" ("id_proveedor");
alter table gimed."proveedores_favoritos" add foreign key ("id_tipo_material") references gimed."tipos_materiales" ("id") deferrable initially deferred;
alter table gimed."orden_producto" add foreign key ("ref_corrugado") references gimed."materiales" ("id") deferrable initially deferred;
create index on gimed."orden_producto" ("ref_corrugado");
alter table gimed."orden_compra" add foreign key ("id_proveedor") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."orden_compra" ("id_proveedor");
alter table gimed."factura" add foreign key ("id_proveedor") references gimed."proveedor" ("id") deferrable initially deferred;
create index on gimed."factura" ("id_proveedor");
alter table gimed."orden_producto" add foreign key ("id_orden_compra") references gimed."orden_compra" ("id") deferrable initially deferred;
create index on gimed."orden_producto" ("id_orden_compra");
alter table gimed."lote_producto" add foreign key ("id_orden_producto") references gimed."orden_producto" ("id") deferrable initially deferred;
create index on gimed."lote_producto" ("id_orden_producto");
alter table gimed."orden_material" add foreign key ("id_orden_compra") references gimed."orden_compra" ("id") deferrable initially deferred;
create index on gimed."orden_material" ("id_orden_compra");
alter table gimed."orden_otro" add foreign key ("id_orden_compra") references gimed."orden_compra" ("id") deferrable initially deferred;
create index on gimed."orden_otro" ("id_orden_compra");
alter table gimed."orden_material" add foreign key ("id_lote_material") references gimed."lote_material" ("id") deferrable initially deferred;
create index on gimed."orden_material" ("id_lote_material");
alter table gimed."orden_producto" add foreign key ("id_producto") references gimed."productos" ("id") deferrable initially deferred;
create index on gimed."orden_producto" ("id_producto");
alter table gimed."orden_producto" add foreign key ("id_codigo_barras") references gimed."codigos_barras" ("id") deferrable initially deferred;
create index on gimed."orden_producto" ("id_codigo_barras");
alter table gimed."abastecimiento_material" add foreign key ("id_orden_producto") references gimed."orden_producto" ("id") deferrable initially deferred;
alter table gimed."abastecimiento_material" add foreign key ("id_orden_material") references gimed."orden_material" ("id") deferrable initially deferred;
create index on gimed."abastecimiento_material" ("id_orden_material");
alter table gimed."lote_producto" add foreign key ("id_factura") references gimed."factura" ("id") deferrable initially deferred;
create index on gimed."lote_producto" ("id_factura");
alter table gimed."orden_material" add foreign key ("id_factura") references gimed."factura" ("id") deferrable initially deferred;
create index on gimed."orden_material" ("id_factura");
alter table gimed."orden_otro" add foreign key ("id_factura") references gimed."factura" ("id") deferrable initially deferred;
create index on gimed."orden_otro" ("id_factura");

alter table gimed.orden_compra
  add column version bigint not null default 1,
  add column grupo text generated always as (case when tipo_orden = 'producto' then 'producto' else 'material' end) stored,
  add constraint orden_numero_valido check (no_orden ~ '^[1-9][0-9]{0,14}$'),
  add constraint orden_consecutivo_unico unique (grupo, no_orden);
alter table gimed.consecutivo_orden add constraint base_valida check (ultimo_numero >= 0);
alter table gimed.orden_producto add constraint orden_producto_posicion check (posicion between 1 and 7);
alter table gimed.orden_material add constraint orden_material_posicion check (posicion between 1 and 7);
alter table gimed.orden_otro add constraint orden_otro_posicion check (posicion between 1 and 7);
alter table gimed.materiales add constraint codigo_maia_valido check (codigo_material between 0 and 999);
alter table gimed.comentario add constraint comentario_un_renglon check (num_nonnulls(id_orden_producto, id_orden_material) = 1);
alter table gimed.correo_enviado_destinatario add foreign key (id_correo, remitente)
  references gimed.correo_enviado deferrable initially deferred;
create unique index codigo_asignado_por_producto on gimed.codigos_barras (id_producto) where estado = 'asignado';
create unique index documento_plantilla_unica on gimed.documento (tipo_documento) where tipo_entidad is null;
alter table gimed.documento add constraint documento_clase_propietario check (
  (
    (tipo_entidad = 'orden_compra' and tipo_documento = 'orden_compra_escaneada' and id_entidad is not null) or
    (tipo_entidad = 'factura' and tipo_documento = 'factura_fisica' and id_entidad is not null) or
    (tipo_entidad = 'lote_material' and tipo_documento in ('certificado_calidad','certificado_liberacion') and id_entidad is not null) or
    (tipo_entidad is null and tipo_documento = 'plantilla_certificado_liberacion' and id_entidad is null)
  ) is true
);
alter table gimed.documento
  add column orden_propietaria uuid generated always as (case when tipo_entidad = 'orden_compra' then id_entidad end) stored,
  add column factura_propietaria uuid generated always as (case when tipo_entidad = 'factura' then id_entidad end) stored,
  add column lote_propietario uuid generated always as (case when tipo_entidad = 'lote_material' then id_entidad end) stored;
alter table gimed.documento
  add foreign key (orden_propietaria) references gimed.orden_compra deferrable initially deferred,
  add foreign key (factura_propietaria) references gimed.factura deferrable initially deferred,
  add foreign key (lote_propietario) references gimed.lote_material deferrable initially deferred;
create index on gimed.documento (orden_propietaria) where orden_propietaria is not null;
create index on gimed.documento (factura_propietaria) where factura_propietaria is not null;
create index on gimed.documento (lote_propietario) where lote_propietario is not null;

create function gimed.controlar_orden() returns trigger language plpgsql set search_path = pg_catalog, gimed as $$
begin
  if new.no_orden <> old.no_orden or new.tipo_orden <> old.tipo_orden or
     (old.estado_autorizacion = 'autorizada' and
       (new.estado_autorizacion <> old.estado_autorizacion or new.id_proveedor <> old.id_proveedor))
  then raise exception 'No se puede cambiar el número, tipo o proveedor autorizado' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger controlar_orden before update on gimed.orden_compra
  for each row execute function gimed.controlar_orden();

create table gimed.audit_event (
  id uuid primary key default gen_random_uuid(),
  actor uuid references gimed.usuario,
  accion text not null,
  colecciones jsonb not null default '[]'::jsonb,
  fecha timestamptz not null default now()
);
create table gimed.identity (
  user_id uuid primary key references gimed.usuario,
  google_subject text not null unique,
  email text not null,
  disabled_at timestamptz
);
create table gimed.session (
  token_hash text primary key,
  user_id uuid not null references gimed.identity,
  tokens text not null,
  access_expires_at timestamptz not null,
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index on gimed.session (user_id);
create index on gimed.session (expires_at);
create table gimed.oauth_state (
  state_hash text primary key,
  flow text not null check (flow in ('login','gmail')),
  session_hash text,
  verifier text not null,
  nonce text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index on gimed.oauth_state (expires_at);
create table gimed.gmail_connection (
  user_id uuid primary key references gimed.identity,
  refresh_token text not null
);
create table gimed.mail_attempt (
  user_id uuid not null references gimed.identity,
  attempt_key text not null,
  fingerprint text not null,
  status text not null check (status in ('sending','sent','rejected','uncertain')),
  response jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, attempt_key)
);
create unique index correo_en_conciliacion on gimed.mail_attempt (user_id, fingerprint)
  where status in ('sending', 'uncertain');
create table gimed.idempotency (
  actor uuid not null references gimed.usuario,
  request_key uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor, request_key)
);
create index on gimed.idempotency (created_at);
create table gimed.file_object (
  id uuid primary key,
  actor uuid not null references gimed.usuario,
  object_key text not null unique,
  document_id uuid not null,
  owner_type text,
  owner_id uuid,
  document_type text not null,
  expected_key text,
  filename text not null,
  mime text not null,
  expected_bytes bigint not null check (expected_bytes between 1 and 26214400),
  accounted_bytes bigint not null check (accounted_bytes between 1 and 26214400),
  status text not null check (status in ('pending','active','retired')),
  created_at timestamptz not null default now()
);
create index on gimed.file_object (status, created_at);
create table gimed.catalog_import (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create table gimed.workspace_revision (
  id int primary key check (id = 1),
  revision bigint not null default 0
);
insert into gimed.workspace_revision (id) values (1);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gimed-documentos','gimed-documentos',false,26214400,
  array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
revoke all on all tables in schema gimed from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema gimed to gimed_runtime;
revoke update, delete on gimed.audit_event, gimed.catalog_import from gimed_runtime;
