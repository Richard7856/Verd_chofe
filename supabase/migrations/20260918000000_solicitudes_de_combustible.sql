-- Pedir la carga antes de hacerla.
--
-- Hasta ahora el chofer cargaba y después registraba: el gasto llegaba
-- consumado y al admin sólo le quedaba aprobarlo o pelearlo. El circuito
-- nuevo invierte el orden:
--
--     solicitud → aprobación del admin → evidencia (ticket) → revisión
--
-- Lo que cambia de fondo es quién autoriza el gasto y cuándo. Antes se
-- revisaba un hecho; ahora se autoriza una intención, y la evidencia se
-- contrasta contra lo autorizado. Si el chofer pidió 40 L y el ticket dice
-- 55, eso queda a la vista sin tener que deducirlo del rendimiento.
--
-- La solicitud NO es offline. Todo lo demás en la app funciona sin señal
-- porque es un registro que puede esperar; esto es una conversación con una
-- persona, y guardarla en el teléfono sólo haría que el chofer se quede
-- esperando una respuesta que nadie vio.

create table public.solicitudes_combustible (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  chofer_id     uuid not null references public.choferes (id),
  unidad_id     uuid not null references public.unidades (id),
  checklist_id  uuid references public.checklists_unidad (id) on delete set null,

  fecha         date not null default current_date,
  -- Lo que pide el chofer. Los litros son estimados: en la bomba redondea.
  litros        numeric(10,2) check (litros is null or litros > 0),
  monto_estimado numeric(12,2) check (monto_estimado is null or monto_estimado > 0),
  estacion      text,
  km            integer check (km is null or km >= 0),
  motivo        text,
  lat           double precision,
  lng           double precision,

  estado        text not null default 'pendiente'
                check (estado in ('pendiente', 'aprobada', 'rechazada', 'cargada', 'cancelada')),

  -- El admin puede autorizar menos de lo pedido. Contra esto se mide el
  -- ticket, no contra lo que el chofer pidió.
  litros_autorizados numeric(10,2) check (litros_autorizados is null or litros_autorizados > 0),
  monto_autorizado   numeric(12,2) check (monto_autorizado is null or monto_autorizado > 0),

  resuelta_por  uuid references auth.users (id),
  resuelta_el   timestamptz,
  nota          text,

  cargada_el    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Una sola solicitud viva por chofer. Dos abiertas al mismo tiempo dejarían
-- a la app sin saber a cuál pertenece el ticket que se acaba de subir, y al
-- admin aprobando la misma carga dos veces.
create unique index solicitudes_combustible_abierta_idx
  on public.solicitudes_combustible (chofer_id)
  where estado in ('pendiente', 'aprobada');

create index solicitudes_combustible_pendientes_idx
  on public.solicitudes_combustible (empresa_id, created_at desc)
  where estado = 'pendiente';
create index solicitudes_combustible_chofer_idx
  on public.solicitudes_combustible (chofer_id, created_at desc);
create index solicitudes_combustible_empresa_idx
  on public.solicitudes_combustible (empresa_id, fecha desc);

create trigger tg_solicitudes_combustible_updated_at
  before update on public.solicitudes_combustible
  for each row execute function public.set_updated_at();

-- La carga apunta a la solicitud que la autorizó. Una sola FK entre las dos
-- tablas a propósito: con dos, PostgREST no sabe por cuál embeber.
alter table public.cargas_combustible
  add column if not exists solicitud_id uuid unique
    references public.solicitudes_combustible (id) on delete set null;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.solicitudes_combustible enable row level security;

create policy solicitudes_combustible_select on public.solicitudes_combustible
  for select to authenticated
  using (
    empresa_id in (select public.empresa_ids_actual())
    and (
      (select public.es_admin())
      or chofer_id in (select public.chofer_ids_actual())
    )
  );

-- El chofer sólo puede crear la suya, y siempre naciendo pendiente: las
-- columnas de resolución tienen que venir vacías o se estaría autorizando
-- solo.
create policy solicitudes_combustible_insert on public.solicitudes_combustible
  for insert to authenticated
  with check (
    empresa_id in (select public.empresa_ids_actual())
    and chofer_id in (select public.chofer_ids_actual())
    and estado = 'pendiente'
    and resuelta_por is null
    and litros_autorizados is null
    and monto_autorizado is null
  );

-- Y no puede actualizar: no hay policy de UPDATE para el chofer. Cancelar lo
-- hace la función de abajo, que además verifica el estado. Una policy no
-- alcanzaría — no puede comparar el valor viejo contra el nuevo, así que
-- cualquier UPDATE permitido le dejaría poner `estado = 'aprobada'`.
create policy solicitudes_combustible_admin on public.solicitudes_combustible
  for all to authenticated
  using (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()))
  with check (empresa_id in (select public.empresa_ids_actual()) and (select public.es_admin()));

-- =====================================================================
-- Cancelar la propia solicitud
-- =====================================================================
-- Sirve para el dedazo: pidió 200 L en vez de 20 y quiere rehacerla. Sólo
-- mientras nadie la resolvió; una vez aprobada, la cancela el admin.
create or replace function public.cancelar_solicitud_combustible(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.solicitudes_combustible s
  set estado = 'cancelada'
  where s.id = p_id
    and s.estado = 'pendiente'
    and s.chofer_id in (select public.chofer_ids_actual());

  if not found then
    raise exception 'La solicitud ya no se puede cancelar';
  end if;
end;
$$;

revoke all on function public.cancelar_solicitud_combustible(uuid) from public;
grant execute on function public.cancelar_solicitud_combustible(uuid) to authenticated;

-- =====================================================================
-- La evidencia cierra la solicitud
-- =====================================================================
-- Se hace acá y no en la app para que sea una sola operación: si el teléfono
-- se apaga entre subir el ticket y marcar la solicitud, la solicitud queda
-- viva y el chofer no puede pedir otra.
--
-- `security definer` porque el chofer no tiene UPDATE sobre la tabla, y no
-- debe tenerlo.
create or replace function public.marcar_solicitud_cargada()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_estado text;
begin
  if new.solicitud_id is null then return new; end if;

  select s.estado into v_estado
  from public.solicitudes_combustible s
  where s.id = new.solicitud_id
    and s.chofer_id = new.chofer_id;

  if v_estado is null then
    raise exception 'La solicitud no existe o es de otro chofer';
  end if;

  -- 'cargada' es el reintento del envío: la cola de la app es idempotente y
  -- puede mandar la misma carga dos veces.
  if v_estado not in ('aprobada', 'cargada') then
    raise exception 'La carga necesita una solicitud aprobada (está %)', v_estado;
  end if;

  update public.solicitudes_combustible
  set estado = 'cargada', cargada_el = coalesce(cargada_el, now())
  where id = new.solicitud_id;

  return new;
end;
$$;

create trigger tg_cargas_marcan_solicitud
  after insert or update of solicitud_id on public.cargas_combustible
  for each row execute function public.marcar_solicitud_cargada();

-- =====================================================================
-- Avisarle al chofer
-- =====================================================================
-- El chofer está parado en la gasolinera esperando el sí. El aviso es lo que
-- le llega sin que tenga que estar recargando la pantalla.
create or replace function public.avisar_resolucion_solicitud()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_titulo text;
  v_cuerpo text;
begin
  if new.estado = old.estado then return new; end if;

  if new.estado = 'aprobada' then
    v_titulo := 'Carga de combustible aprobada';
    v_cuerpo := 'Ya podés cargar' ||
      coalesce(' hasta ' || trim(to_char(new.litros_autorizados, 'FM999990.00')) || ' litros', '') ||
      '. Después subí la foto del ticket desde la app.' ||
      coalesce(' Nota: ' || new.nota, '');
  elsif new.estado = 'rechazada' then
    v_titulo := 'Carga de combustible rechazada';
    v_cuerpo := 'No se autorizó la carga que pediste.' ||
      coalesce(' Motivo: ' || new.nota, ' Consultá con tu supervisor.');
  else
    return new;
  end if;

  insert into public.avisos_chofer
    (empresa_id, chofer_id, titulo, cuerpo, tipo, origen, clave, creado_por)
  values
    (new.empresa_id, new.chofer_id, v_titulo, v_cuerpo, 'aviso', 'automatico',
     'solicitud:' || new.id::text || ':' || new.estado, new.resuelta_por)
  on conflict (chofer_id, clave) do nothing;

  return new;
end;
$$;

create trigger tg_solicitudes_avisan_al_chofer
  after update of estado on public.solicitudes_combustible
  for each row execute function public.avisar_resolucion_solicitud();

comment on table public.solicitudes_combustible is
  'Pedido de carga de combustible. El admin autoriza antes de que el chofer cargue; la evidencia se sube después y se contrasta contra lo autorizado.';

-- Las funciones de trigger no tienen por qué ser llamables desde la API.
-- Llamarlas por RPC falla igual (Postgres exige que se invoquen como
-- trigger), pero dejarlas expuestas ensucia la superficie y el linter de
-- seguridad las marca. Se les quita EXECUTE a todo el mundo: el trigger las
-- ejecuta como dueño de la tabla, no por este permiso.
revoke all on function public.marcar_solicitud_cargada() from public, anon, authenticated;
revoke all on function public.avisar_resolucion_solicitud() from public, anon, authenticated;
