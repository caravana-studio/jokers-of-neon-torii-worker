# Pagos extensibles — plan del worker

Fecha: 2026-10-15. Estado: **plan; implementación pendiente**.

Rama: `feat/multichain-payments`, creada desde `release/v2` (`8cb511d`).

El plan canónico, contrato y decisiones están en [API / PLAN.md](../jokers-of-neon-api/PLAN.md). Este archivo identifica el trabajo de este repositorio sin duplicar las decisiones del dominio.

## Alcance

- Adaptador `evm_erc20_transfer` para Celo Sepolia: USDC, USDT y USDm. MiniPay es el canal del frontend; el verificador debe poder reutilizarse con otras wallets/redes EVM.
- Treasury Sepolia: `0xd9A5E955603c9A68a553aB9BD676F31c547572a6`. Mainnet queda deshabilitado.
- Observar hashes notificados y logs de transferencias a treasury con cursor durable, finalización explícita y asociación inequívoca a orden.
- Entregar pack sellado o pase/beneficios mediante commerce SQL común, exactamente una vez.
- Sin devoluciones, apertura de packs, settlement NFT, cambios de Core ni activación/migración de RevenueCat.

## Dependencias y ejecución

1. API Phase 0 fija contrato/version de evidencia, configuración pública, precios y estados.
2. API Phase 1 publica migraciones compatibles, RPCs, cursores e integración con `ops.jobs`.
3. Workstream B implementa adaptadores, observación, recuperación y entrega usando leases/fencing. Puede desarrollarse con fixtures mientras se implementa API, pero necesita SQL para integración.
4. Integrar procesos de commerce y gameplay con ciclos independientes en Render staging, manejo de señales y errores aislados. Una caída de Katana/Torii no impide cobrar/verificar/entregar.
5. Integración HTTP/SQL/worker local y pruebas de pagos Sepolia en MiniPay con Nico, siguiendo el plan canónico.

## Archivos iniciales

- `src/v2/commerceWorker.ts`: entrega y trabajos recuperables, sin dependencia de una cadena concreta.
- `src/v2/commerceIndex.ts`: registro/configuración de proveedores, observación y lifecycle independiente.
- `src/v2/processingJobs.ts`: reutilizar contrato de leases; agregar kinds/versiones mediante SQL compatible.
- `src/v2/index.ts`, `src/v2/terminalWorker.ts`, `tsup.config.ts`: integración de procesos sin acoplar commerce al runtime ni duplicar entregas.
- `src/v2/commerce/`: módulos de adaptadores/observación, ubicación propuesta.
- `tests/v2/commerce.test.ts` y nuevas pruebas de verificación, cursor, recuperación y contratos.

## Validación

```sh
npm run build
bun test tests/v2
```

La API incorporará `test:v2:commerce:celo` y `test:v2:commerce:upgrade` para comprobar conjuntamente PostgreSQL, HTTP, verificación y entrega.

- [ ] Dos workers, lease vencido y replay no duplican purchase, pack, entitlement ni beneficios.
- [ ] Pago sin submit se descubre y se recupera si no es ambiguo; la ambigüedad queda en revisión.
- [ ] Reorg/RPC fallido/finality ausente conservan estado recuperable; cursor y observaciones se guardan juntos.
- [ ] Pagos inválidos/extra se conservan como evidencia, sin entrega ni movimientos de dinero.
- [ ] Un proveedor o trabajo bloqueado no detiene otros pagos ni gameplay.
- [ ] Runtime caído y colección NFT ausente no impiden registrar la compra.
- [ ] No se activa RevenueCat v2, no se modifican credenciales o servicios productivos.
