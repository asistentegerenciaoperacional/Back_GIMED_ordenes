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
