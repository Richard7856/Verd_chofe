-- Saldo de combustible por unidad, para detectar faltantes.
--
-- La idea: el tanque se lleva como una cuenta. Se parte de un corte —alguien
-- mide cuántos litros hay— y a partir de ahí:
--
--     saldo = corte + litros cargados − (km recorridos ÷ rendimiento)
--
-- Cuando se vuelve a medir, la diferencia entre lo que el sistema creía y lo
-- que hay de verdad es la merma del periodo. Un faltante sostenido es lo que
-- delata el robo; un día suelto se pierde en el margen de error.
--
-- Dos límites que conviene tener presentes:
--
--   · El rendimiento real varía con la carga, el tráfico y el manejo, así que
--     el saldo teórico se va desviando. Hay que re-aforar cada tanto; para
--     eso el corte guarda contra qué se comparó.
--   · Si el chofer infla los km, el cálculo "consume" litros de más y el
--     faltante se esconde. Los km cuadrados contra la ruta de TripDrive son
--     los que sostienen todo esto.

create table public.combustible_cortes (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id),
  unidad_id       uuid not null references public.unidades (id) on delete cascade,

  fecha           date not null,
  -- Lo que se midió en el tanque.
  litros          numeric(10,2) not null check (litros >= 0),
  -- Lo que el sistema creía que había. Se guarda al hacer el corte para que
  -- la merma del periodo quede registrada sin tener que recalcularla.
  litros_teoricos numeric(10,2),

  nota            text,
  creado_por      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

create index combustible_cortes_unidad_idx
  on public.combustible_cortes (unidad_id, fecha desc);

alter table public.combustible_cortes enable row level security;

create policy combustible_cortes_admin on public.combustible_cortes
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- =====================================================================
-- El balance
-- =====================================================================
-- Devuelve el desglose desde el último corte hasta la fecha pedida. Sin
-- corte no hay saldo: inventarlo daría un número con apariencia de dato.
create or replace function public.balance_combustible(p_unidad uuid, p_hasta date)
returns table (
  corte_fecha       date,
  corte_litros      numeric,
  rendimiento       numeric,
  litros_cargados   numeric,
  km_recorridos     numeric,
  litros_consumidos numeric,
  saldo             numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_corte  public.combustible_cortes%rowtype;
  v_rend   numeric;
begin
  -- Sólo un admin de la empresa de la unidad.
  if not (select public.es_admin()) then
    raise exception 'Sólo un administrador puede consultar el saldo';
  end if;

  select coalesce(u.rendimiento_km_litro, 8) into v_rend
  from public.unidades u
  where u.id = p_unidad
    and u.empresa_id in (select public.empresa_ids_actual());

  if v_rend is null then return; end if;

  select * into v_corte
  from public.combustible_cortes c
  where c.unidad_id = p_unidad and c.fecha <= p_hasta
  order by c.fecha desc, c.created_at desc
  limit 1;

  if v_corte.id is null then return; end if;

  corte_fecha  := v_corte.fecha;
  corte_litros := v_corte.litros;
  rendimiento  := v_rend;

  -- El día del corte ya está medido: lo de ese día no se vuelve a contar.
  select coalesce(sum(k.litros), 0) into litros_cargados
  from public.cargas_combustible k
  where k.unidad_id = p_unidad
    and k.fecha > v_corte.fecha and k.fecha <= p_hasta
    and k.estado_revision <> 'rechazado';

  -- Los recorridos imposibles quedan fuera: un dedazo en el odómetro
  -- vaciaría el tanque en el papel.
  select coalesce(sum(c.km_final - c.km_inicial), 0) into km_recorridos
  from public.checklists_unidad c
  where c.unidad_id = p_unidad
    and c.fecha > v_corte.fecha and c.fecha <= p_hasta
    and c.km_inicial is not null and c.km_final is not null
    and c.km_final - c.km_inicial between 0 and 1500;

  litros_consumidos := round(km_recorridos / v_rend, 2);
  saldo := round(v_corte.litros + litros_cargados - litros_consumidos, 2);

  return next;
end;
$$;

revoke all on function public.balance_combustible(uuid, date) from public;
grant execute on function public.balance_combustible(uuid, date) to authenticated;
