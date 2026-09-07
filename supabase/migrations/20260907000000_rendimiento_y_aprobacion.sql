-- Rendimiento esperado por unidad y aprobación del gasto.
--
-- El cierre del circuito: ya sabemos los km del turno y podemos contrastarlos
-- contra el plan de TripDrive. Con los litros cargados sale el rendimiento
-- real, y compararlo contra lo que esa camioneta debería rendir es lo que
-- dice si el consumo tiene sentido.
--
-- Quién decide es una persona, no una regla automática: siempre hay
-- diferencia —tráfico, carga, ralentí— y ningún umbral acierta solo. El
-- sistema marca lo que se sale de rango y el admin aprueba o rechaza.

alter table public.unidades
  add column if not exists rendimiento_km_litro numeric(5,2) default 8.0
    check (rendimiento_km_litro is null or rendimiento_km_litro > 0);

comment on column public.unidades.rendimiento_km_litro is
  'Kilómetros por litro que se espera de esta unidad. Contra esto se compara el consumo real.';

-- ------------------------------------------------------- aprobación
-- Mismas columnas en los dos orígenes: el flujo es idéntico y así el panel
-- los trata igual.
alter table public.cargas_combustible
  add column if not exists estado_revision text not null default 'pendiente'
    check (estado_revision in ('pendiente', 'aprobado', 'rechazado')),
  add column if not exists revisado_por uuid references auth.users (id),
  add column if not exists revisado_el timestamptz,
  add column if not exists nota_revision text;

alter table public.gastos_chofer
  add column if not exists estado_revision text not null default 'pendiente'
    check (estado_revision in ('pendiente', 'aprobado', 'rechazado')),
  add column if not exists revisado_por uuid references auth.users (id),
  add column if not exists revisado_el timestamptz,
  add column if not exists nota_revision text;

-- Parciales: lo que se busca es la cola de pendientes, no el histórico.
create index if not exists cargas_combustible_pendientes_idx
  on public.cargas_combustible (empresa_id, fecha desc)
  where estado_revision = 'pendiente';

create index if not exists gastos_chofer_pendientes_idx
  on public.gastos_chofer (empresa_id, fecha desc)
  where estado_revision = 'pendiente';
