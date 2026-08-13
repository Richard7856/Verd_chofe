-- Gastos del turno que no son combustible: aceite, anticongelante,
-- ponchadura y cualquier otro que surja en ruta.
--
-- Tabla propia y no la `gastos` que ya existe en dash: aquélla es del control
-- administrativo y tiene otro flujo. Mezclarlas obligaría a que el chofer
-- escriba en una tabla del área de finanzas.

create table public.gastos_chofer (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas (id),
  chofer_id    uuid not null references public.choferes (id),
  unidad_id    uuid not null references public.unidades (id),
  checklist_id uuid references public.checklists_unidad (id) on delete set null,

  fecha        date not null default current_date,
  tipo         text not null
               check (tipo in ('aceite', 'anticongelante', 'ponchadura', 'otro')),
  descripcion  text,
  monto        numeric(12,2) not null check (monto > 0),
  lugar        text,
  folio        text,
  km           integer check (km >= 0),
  ticket_ruta  text,
  lat          double precision,
  lng          double precision,

  cliente_uuid uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- "Otro" sin explicación no sirve para nada al que revisa después.
  constraint gastos_chofer_otro_explicado
    check (tipo <> 'otro' or (descripcion is not null and char_length(trim(descripcion)) >= 3)),
  constraint gastos_chofer_cliente_uuid_uniq unique (empresa_id, cliente_uuid)
);

create index gastos_chofer_chofer_idx  on public.gastos_chofer (chofer_id, fecha desc);
create index gastos_chofer_unidad_idx  on public.gastos_chofer (unidad_id, fecha desc);
create index gastos_chofer_empresa_idx on public.gastos_chofer (empresa_id, fecha desc);

create trigger tg_gastos_chofer_updated_at
  before update on public.gastos_chofer
  for each row execute function public.set_updated_at();

alter table public.gastos_chofer enable row level security;

create policy gastos_chofer_select on public.gastos_chofer
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select public.chofer_ids_actual())
    )
  );

create policy gastos_chofer_insert on public.gastos_chofer
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and chofer_id in (select public.chofer_ids_actual())
  );

-- Un gasto enviado no lo edita el chofer: es un comprobante.
create policy gastos_chofer_admin on public.gastos_chofer
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));
