-- =====================================================================
-- Módulo de Choferes  ·  proyecto `dash` (uqgcjyopoaisuglljnuc)
-- Check List de Unidad + Carga de Combustible + Incidencias
-- =====================================================================
-- Sólo CREATE. No modifica ni borra nada de lo que ya existe.
--
-- Convenciones tomadas de `dash`:
--   * nombres y columnas en español
--   * `empresa_id` referenciando `empresas` (Euromex / Garritas / Cigarros / Verdfrut)
--   * `activo` en vez de `is_active`
--   * trigger `set_updated_at()`, que ya existe en el proyecto
--
-- `cliente_uuid` + UNIQUE hace idempotente la sincronización offline: si al
-- chofer se le corta la señal a mitad del envío, reintentar no duplica.
-- =====================================================================

begin;

-- =====================================================================
-- 1 · Helpers de RLS
-- =====================================================================
-- `dash` no tenía helpers de rol. Son funciones nuevas; no pisan nada.

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.rol = 'admin' from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- Empresas visibles para el usuario actual.
-- `empresas_permitidas` NULL significa "todas": así funcionan hoy los admins.
-- El arreglo se trae en un CTE a propósito: escrito como
-- `e.slug = any((select empresas_permitidas from ...))`, Postgres lee el
-- paréntesis como subconsulta y falla con "operator does not exist:
-- text = text[]". Como referencia de columna (`p.perm`) sí toma la forma
-- de arreglo.
create or replace function public.empresa_ids_actual()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with p as (
    select pr.empresas_permitidas as perm
    from public.profiles pr
    where pr.id = (select auth.uid())
  )
  select e.id
  from public.empresas e, p
  where e.activo
    and (p.perm is null or e.slug = any(p.perm));
$$;

revoke all on function public.es_admin()           from public;
revoke all on function public.empresa_ids_actual() from public;

grant execute on function public.es_admin()           to authenticated;
grant execute on function public.empresa_ids_actual() to authenticated;

-- `es_chofer()` y `chofer_ids_actual()` se definen en la sección 2,
-- después de crear la tabla `choferes` que consultan.

-- =====================================================================
-- 2 · Unidades (vehículos) y choferes
-- =====================================================================
-- `dash` no tenía ninguno de los dos conceptos. `vf_empleados` no sirve:
-- son honorarios, sin vínculo con auth.users.

create table public.unidades (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  placa      text not null,
  alias      text,
  marca      text,
  modelo     text,
  anio       integer check (anio between 1950 and 2100),
  bodega_id  uuid references public.bodegas (id),
  estado     text not null default 'disponible'
             check (estado in ('disponible', 'en_ruta', 'mantenimiento', 'inactiva')),
  activo     boolean not null default true,
  notas      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, placa)
);

create index unidades_empresa_idx on public.unidades (empresa_id) where activo;

create table public.choferes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users (id) on delete cascade,
  empresa_id      uuid not null references public.empresas (id),
  nombre          text not null,
  telefono        text,
  licencia_numero text,
  licencia_vence_el date,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index choferes_empresa_idx on public.choferes (empresa_id) where activo;

-- Ser chofer NO se decide por `profiles.rol`: esa columna la puede cambiar el
-- propio usuario (política `profiles_update_own` no restringe columnas), así
-- que serviría para auto-promoverse y saltarse los bloqueos. Se decide por
-- existir en `choferes`, tabla que sólo un admin puede escribir.
create or replace function public.es_chofer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.choferes c
    where c.user_id = (select auth.uid()) and c.activo
  );
$$;

create or replace function public.chofer_ids_actual()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select c.id from public.choferes c where c.user_id = (select auth.uid());
$$;

revoke all on function public.es_chofer()         from public;
revoke all on function public.chofer_ids_actual() from public;

grant execute on function public.es_chofer()         to authenticated;
grant execute on function public.chofer_ids_actual() to authenticated;

-- Unidad asignada · el "Cambiar unidad" de la pantalla de inicio
create table public.chofer_unidad_asignaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id),
  chofer_id   uuid not null references public.choferes (id) on delete cascade,
  unidad_id   uuid not null references public.unidades (id) on delete cascade,
  asignada_el timestamptz not null default now(),
  liberada_el timestamptz,
  created_at  timestamptz not null default now()
);

-- Un chofer, una unidad activa a la vez.
create unique index chofer_unidad_activa_idx
  on public.chofer_unidad_asignaciones (chofer_id) where liberada_el is null;
create index chofer_unidad_por_unidad_idx
  on public.chofer_unidad_asignaciones (unidad_id) where liberada_el is null;

-- =====================================================================
-- 3 · Catálogos del check list
-- =====================================================================
-- Editables por el cliente sin recompilar la app. El mockup mostraba 11
-- ítems pero el resumen decía "48/48": la lista real se define acá.

create table public.checklist_catalogo_items (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo     text not null,
  etiqueta   text not null,
  grupo      text,
  orden      integer not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table public.checklist_catalogo_fotos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  codigo      text not null,
  etiqueta    text not null,
  orden       integer not null default 0,
  obligatoria boolean not null default true,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- =====================================================================
-- 4 · Check list de unidad
-- =====================================================================

create table public.checklists_unidad (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id),
  chofer_id    uuid not null references public.choferes (id),
  unidad_id    uuid not null references public.unidades (id),
  bodega_id    uuid references public.bodegas (id),
  estado       text not null default 'en_progreso'
               check (estado in ('en_progreso', 'completado', 'cancelado')),

  fecha        date not null default current_date,

  -- Paso 1 · Entrada
  entrada_el      timestamptz,
  km_inicial      integer check (km_inicial >= 0),
  entrada_lat     double precision,
  entrada_lng     double precision,

  -- Paso 4 · Salida
  salida_el       timestamptz,
  km_final        integer check (km_final >= 0),
  salida_lat      double precision,
  salida_lng      double precision,
  ruta_turno      text,
  observaciones   text,

  -- Paso 6 · Firma
  firma_ruta      text,
  firmado_el      timestamptz,

  completado_el   timestamptz,

  cliente_uuid    uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint checklists_unidad_km_orden
    check (km_final is null or km_inicial is null or km_final >= km_inicial),
  constraint checklists_unidad_cliente_uuid_uniq
    unique (empresa_id, cliente_uuid)
);

create index checklists_unidad_chofer_idx  on public.checklists_unidad (chofer_id, fecha desc);
create index checklists_unidad_unidad_idx  on public.checklists_unidad (unidad_id, fecha desc);
create index checklists_unidad_empresa_idx on public.checklists_unidad (empresa_id, estado);

create table public.checklist_unidad_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists_unidad (id) on delete cascade,
  codigo       text not null,
  etiqueta     text not null,   -- congelada: el catálogo puede cambiar después
  estado       text not null check (estado in ('ok', 'no_ok', 'na')),
  nota         text,
  orden        integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (checklist_id, codigo)
);

create index checklist_unidad_items_checklist_idx on public.checklist_unidad_items (checklist_id);
-- para el reporte "¿qué unidad falla frenos seguido?"
create index checklist_unidad_items_fallas_idx
  on public.checklist_unidad_items (codigo) where estado = 'no_ok';

create table public.checklist_unidad_fotos (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists_unidad (id) on delete cascade,
  codigo       text not null,
  etiqueta     text not null,
  ruta         text not null,
  tomada_el    timestamptz,
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now(),
  unique (checklist_id, codigo)
);

create index checklist_unidad_fotos_checklist_idx on public.checklist_unidad_fotos (checklist_id);

-- =====================================================================
-- 5 · Carga de combustible
-- =====================================================================

create table public.cargas_combustible (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  chofer_id      uuid not null references public.choferes (id),
  unidad_id      uuid not null references public.unidades (id),
  checklist_id   uuid references public.checklists_unidad (id) on delete set null,

  fecha          date not null default current_date,
  estacion       text,
  litros         numeric(10,3) not null check (litros > 0),
  precio_litro   numeric(10,3) not null check (precio_litro > 0),
  total          numeric(12,2) not null check (total >= 0),
  km             integer check (km >= 0),
  folio          text,
  ticket_ruta    text,
  lat            double precision,
  lng            double precision,

  cliente_uuid   uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint cargas_combustible_cliente_uuid_uniq unique (empresa_id, cliente_uuid)
);

create index cargas_combustible_chofer_idx on public.cargas_combustible (chofer_id, fecha desc);
create index cargas_combustible_unidad_idx on public.cargas_combustible (unidad_id, fecha desc);

-- =====================================================================
-- 6 · Incidencias
-- =====================================================================

create table public.incidencias_chofer (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id),
  chofer_id    uuid not null references public.choferes (id),
  unidad_id    uuid references public.unidades (id) on delete set null,
  checklist_id uuid references public.checklists_unidad (id) on delete set null,

  tipo         text not null check (tipo in ('camino', 'entrega', 'unidad', 'otro')),
  descripcion  text not null check (char_length(descripcion) between 5 and 2000),
  foto_ruta    text,
  lat          double precision,
  lng          double precision,

  estado       text not null default 'abierta'
               check (estado in ('abierta', 'vista', 'resuelta', 'cancelada')),
  atendida_el  timestamptz,
  atendida_por uuid references auth.users (id),
  notas_cierre text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index incidencias_chofer_empresa_idx on public.incidencias_chofer (empresa_id, estado);
create index incidencias_chofer_chofer_idx  on public.incidencias_chofer (chofer_id, created_at desc);

-- =====================================================================
-- 7 · Triggers de updated_at  (reutiliza la función que ya existe)
-- =====================================================================

create trigger tg_unidades_updated_at            before update on public.unidades
  for each row execute function public.set_updated_at();
create trigger tg_choferes_updated_at            before update on public.choferes
  for each row execute function public.set_updated_at();
create trigger tg_checklists_unidad_updated_at   before update on public.checklists_unidad
  for each row execute function public.set_updated_at();
create trigger tg_cargas_combustible_updated_at  before update on public.cargas_combustible
  for each row execute function public.set_updated_at();
create trigger tg_incidencias_chofer_updated_at  before update on public.incidencias_chofer
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 8 · RLS
-- =====================================================================
-- A diferencia del resto de `dash`, acá NO se usa `USING (true)`: estas
-- tablas las va a tocar gente con la app en el bolsillo, fuera de la oficina.

alter table public.unidades                  enable row level security;
alter table public.choferes                  enable row level security;
alter table public.chofer_unidad_asignaciones enable row level security;
alter table public.checklist_catalogo_items  enable row level security;
alter table public.checklist_catalogo_fotos  enable row level security;
alter table public.checklists_unidad         enable row level security;
alter table public.checklist_unidad_items    enable row level security;
alter table public.checklist_unidad_fotos    enable row level security;
alter table public.cargas_combustible        enable row level security;
alter table public.incidencias_chofer        enable row level security;

-- ---------------------------------------------------------- choferes
create policy choferes_select on public.choferes
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or user_id = (select auth.uid()))
  );

create policy choferes_admin on public.choferes
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- ---------------------------------------------------------- unidades
create policy unidades_select on public.unidades
  for select to authenticated
  using (empresa_id in (select public.empresa_ids_actual()));

create policy unidades_admin on public.unidades
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- ------------------------------------------------------- asignaciones
create policy asignaciones_select on public.chofer_unidad_asignaciones
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

create policy asignaciones_insert on public.chofer_unidad_asignaciones
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

create policy asignaciones_update on public.chofer_unidad_asignaciones
  for update to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  )
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

-- ---------------------------------------------------------- catálogos
create policy catalogo_items_select on public.checklist_catalogo_items
  for select to authenticated
  using (empresa_id in (select public.empresa_ids_actual()));

create policy catalogo_items_admin on public.checklist_catalogo_items
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

create policy catalogo_fotos_select on public.checklist_catalogo_fotos
  for select to authenticated
  using (empresa_id in (select public.empresa_ids_actual()));

create policy catalogo_fotos_admin on public.checklist_catalogo_fotos
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- ------------------------------------------------------- check lists
create policy checklists_select on public.checklists_unidad
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

create policy checklists_insert on public.checklists_unidad
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and chofer_id in (select public.chofer_ids_actual())
  );

-- El chofer sólo edita mientras está en progreso; el admin siempre.
create policy checklists_update on public.checklists_unidad
  for update to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or (chofer_id in (select public.chofer_ids_actual()) and estado = 'en_progreso')
    )
  )
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

-- ------------------------------------------- ítems y fotos (heredan)
create policy checklist_items_select on public.checklist_unidad_items
  for select to authenticated
  using (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and ((select public.es_admin()) or c.chofer_id in (select public.chofer_ids_actual()))
  ));

create policy checklist_items_write on public.checklist_unidad_items
  for all to authenticated
  using (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and c.chofer_id in (select public.chofer_ids_actual())
      and c.estado = 'en_progreso'
  ))
  with check (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and c.chofer_id in (select public.chofer_ids_actual())
      and c.estado = 'en_progreso'
  ));

create policy checklist_fotos_select on public.checklist_unidad_fotos
  for select to authenticated
  using (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and ((select public.es_admin()) or c.chofer_id in (select public.chofer_ids_actual()))
  ));

create policy checklist_fotos_write on public.checklist_unidad_fotos
  for all to authenticated
  using (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and c.chofer_id in (select public.chofer_ids_actual())
      and c.estado = 'en_progreso'
  ))
  with check (exists (
    select 1 from public.checklists_unidad c
    where c.id = checklist_id
      and c.empresa_id in (select public.empresa_ids_actual())
      and c.chofer_id in (select public.chofer_ids_actual())
      and c.estado = 'en_progreso'
  ));

-- ---------------------------------------------------------- combustible
create policy cargas_select on public.cargas_combustible
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

create policy cargas_insert on public.cargas_combustible
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and chofer_id in (select public.chofer_ids_actual())
  );

-- Una carga enviada no la edita el chofer: es un comprobante de gasto.
create policy cargas_update on public.cargas_combustible
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- ---------------------------------------------------------- incidencias
create policy incidencias_select on public.incidencias_chofer
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and ((select public.es_admin()) or chofer_id in (select public.chofer_ids_actual()))
  );

create policy incidencias_insert on public.incidencias_chofer
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and chofer_id in (select public.chofer_ids_actual())
  );

create policy incidencias_update on public.incidencias_chofer
  for update to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- =====================================================================
-- 9 · Storage: bucket privado para evidencia y firmas
-- =====================================================================
-- No se reutiliza `evidencias-cobros` porque es público: las firmas de
-- conformidad y las fotos de unidad no deberían quedar accesibles por URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checklist-evidencias', 'checklist-evidencias', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Rutas: <empresa_id>/<checklist_id>/<archivo>
--
-- La comparación se hace en TEXTO a propósito. Castear la carpeta a uuid
-- (`(storage.foldername(name))[1]::uuid`) revienta con "invalid input syntax"
-- cuando la ruta no es un UUID, y como Postgres no garantiza evaluar el AND
-- en orden, ese error puede dispararse al subir a CUALQUIER otro bucket
-- (`verdfrut-uploads`, `evidencias-cobros`…), rompiendo el dashboard actual.
create policy checklist_evidencias_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'checklist-evidencias'
    and exists (
      select 1 from public.empresa_ids_actual() e
      where e::text = (storage.foldername(name))[1]
    )
  );

create policy checklist_evidencias_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'checklist-evidencias'
    and exists (
      select 1 from public.empresa_ids_actual() e
      where e::text = (storage.foldername(name))[1]
    )
  );

create policy checklist_evidencias_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'checklist-evidencias'
    and exists (
      select 1 from public.empresa_ids_actual() e
      where e::text = (storage.foldername(name))[1]
    )
  );

-- =====================================================================
-- 10 · Semilla del catálogo
-- =====================================================================
-- Los 11 ítems y 9 fotos del diseño, para las 4 empresas activas.

insert into public.checklist_catalogo_items (empresa_id, codigo, etiqueta, grupo, orden)
select e.id, v.codigo, v.etiqueta, v.grupo, v.orden
from public.empresas e
cross join (values
  ('luces',            'Luces (Altas, Bajas, Intermitentes, Freno)', 'Exterior',  10),
  ('direccionales',    'Direccionales / Intermitentes',              'Exterior',  20),
  ('frenos',           'Frenos',                                     'Mecánica',  30),
  ('claxon',           'Claxon',                                     'Mecánica',  40),
  ('limpiaparabrisas', 'Limpia parabrisas / Lava parabrisas',        'Cabina',    50),
  ('espejos',          'Espejos retrovisores',                       'Cabina',    60),
  ('niveles',          'Niveles de líquidos',                        'Mecánica',  70),
  ('neumaticos',       'Neumáticos (Estado y Presión)',              'Exterior',  80),
  ('herramientas',     'Herramientas / Gato / Llave de rueda',       'Seguridad', 90),
  ('cinturones',       'Cinturones de seguridad',                    'Seguridad', 100),
  ('extintor',         'Extintor / Botiquín',                        'Seguridad', 110)
) as v(codigo, etiqueta, grupo, orden)
where e.activo
on conflict (empresa_id, codigo) do nothing;

insert into public.checklist_catalogo_fotos (empresa_id, codigo, etiqueta, orden)
select e.id, v.codigo, v.etiqueta, v.orden
from public.empresas e
cross join (values
  ('frente',             'Frente',                        10),
  ('lado_derecho',       'Lado derecho',                  20),
  ('lado_izquierdo',     'Lado izquierdo',                30),
  ('atras',              'Atrás',                         40),
  ('neumatico_del_izq',  'Neumático del. izq.',           50),
  ('neumatico_del_der',  'Neumático del. der.',           60),
  ('neumatico_tras_izq', 'Neumático tras. izq.',          70),
  ('neumatico_tras_der', 'Neumático tras. der.',          80),
  ('caja_interior',      'Caja interior / Área de carga', 90)
) as v(codigo, etiqueta, orden)
where e.activo
on conflict (empresa_id, codigo) do nothing;

commit;
