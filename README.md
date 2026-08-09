# App de Choferes

Check List de Unidad, Carga de Combustible e Incidencias. Una sola base de
código: se sirve como PWA instalable y se compila a APK Android con Capacitor.

## Backend

Se conecta al proyecto Supabase **`dash`** (`uqgcjyopoaisuglljnuc`), que es
multi-empresa: **Euromex** (la default), **Garritas**, **Cigarros** y
**Verdfrut**. Cada registro lleva `empresa_id`, y el chofer sólo ve lo de su
empresa.

> El proyecto `Verdfrut` (`hidlxgajcjbtlwyxerhy`) es de TripDrive y ya tiene su
> propio APK. **No se toca.**

## Arranque

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

## Estado de la base

Las dos migraciones **ya están aplicadas** en `dash`:

| Migración | Qué hizo |
|---|---|
| `20260808000000_modulo_choferes.sql` | Creó 10 tablas, 6 funciones, el bucket privado `checklist-evidencias` y sembró el catálogo (11 ítems + 9 fotos) para las 4 empresas |
| `20260808000001_endurecer_rls_choferes.sql` | Agregó políticas RESTRICTIVAS que le niegan al chofer el acceso al resto de `dash` |

### Tablas del módulo

`unidades`, `choferes`, `chofer_unidad_asignaciones`,
`checklist_catalogo_items`, `checklist_catalogo_fotos`, `checklists_unidad`,
`checklist_unidad_items`, `checklist_unidad_fotos`, `cargas_combustible`,
`incidencias_chofer`.

## Seguridad — cómo está pensado

`dash` tenía 27 tablas con `USING (true)` para `authenticated`, incluida toda
la contabilidad. Eso era tolerable con 14 usuarios internos en un navegador,
pero una app de choferes reparte credenciales en teléfonos que salen a la
calle, y la anon key va dentro del APK. RLS es lo único que separa a un chofer
de `vf_cuentas_cobrar`.

Dos decisiones que sostienen el modelo:

1. **Ser chofer se decide por existir en `choferes`, no por `profiles.rol`.**
   La política `profiles_update_own` deja al usuario editar su propia fila sin
   restringir columnas, así que un rol guardado ahí sería auto-asignable.
   `choferes` sólo la escribe un admin.

2. **Las políticas nuevas son RESTRICTIVAS**, o sea que se combinan con AND
   sobre las que ya existían. No se modificó ni borró ninguna política previa.
   Revertir es `DROP POLICY sin_acceso_choferes ON public.<tabla>;`

También se cerró la auto-promoción a admin con `profiles_rol_inmutable`: el
usuario sigue editando su nombre y teléfono, pero no su `rol` ni sus
`empresas_permitidas`.

### Verificado

| Prueba | Resultado |
|---|---|
| Chofer leyendo `vf_cuentas_cobrar` (1 534 filas) | 0 |
| Chofer leyendo `vf_ventas_producto` (1 744) | 0 |
| Chofer leyendo `vf_flujo_caja` (231) | 0 |
| Chofer leyendo el catálogo y `bodegas` | OK |
| Admin leyendo todo lo anterior | 1 534 / 1 744 / 231 — sin cambios |
| Usuario intentando ponerse `rol = 'admin'` | bloqueado |
| Usuario editando su nombre | OK |

## Funcionamiento offline

Los choferes cargan el check list en el patio, donde muchas veces no hay señal.

- El borrador y las fotos viven en **IndexedDB** (`src/lib/offline.ts`).
- Al enviar, el registro entra en una **cola** y sube cuando hay conexión
  (`src/lib/sync.ts`).
- La sincronización es **idempotente**: `checklists_unidad` y
  `cargas_combustible` tienen `UNIQUE (empresa_id, cliente_uuid)`, así que
  reintentar tras un corte no duplica registros.
- El orden importa: el check list entra como `en_progreso`, después van ítems y
  fotos, y recién al final pasa a `completado` — RLS sólo permite escribir los
  hijos mientras está en progreso.

## APK

```bash
npm run android:sync
```

```bash
npm run android:open
```

Requiere Java y Android Studio (esta máquina no los tiene todavía).

`applicationId` actual: `com.verdfrut.choferes`. **Conviene revisarlo**: la app
sirve a cuatro empresas, no sólo a Verdfrut, y una vez distribuido el APK
cambiar el `applicationId` significa una app distinta.

## Pendientes

- **Dar de alta unidades y choferes.** Las tablas están vacías: sin al menos
  una unidad y un chofer, la app no tiene con qué trabajar.
- **Documentos** e **Historial de Servicios** están en el menú del diseño pero
  no tienen tablas. Las pantallas explican qué haría falta.
- Tres tablas de `dash` siguen con **RLS desactivado** y son accesibles sin
  iniciar sesión: `vf_flujo_caja_detalle` (0 filas), `vf_chat_conversaciones`
  (11) y `vf_chat_mensajes` (54). Activarles RLS requiere revisar antes quién
  las consulta.
- El mockup del cliente tenía números de plantilla: "Paso 1 de 7" con 5
  burbujas, "Fotos 10/10" con 9 slots y "Condiciones 48/48" con 11 ítems. Acá
  los 7 pasos son reales y los conteos salen del catálogo.
