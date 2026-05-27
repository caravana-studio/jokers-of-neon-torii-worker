# Jokers of Neon — Unified Worker

Single long-running process: **Torii event listener**, **transaction intent queue**, **scheduled crons** (daily/weekly mission generation, push notifications, pack distribution), and optional **game agent** burners.

Replaces separate deploys of `jokers-of-neon-torii-worker`, `jokers-of-neon-cron`, and `jokers-of-neon-agent`.

**Entry:** `src/index.ts` → `bun run dev` / `bun run build && bun run start`

**Test before prod:** [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md)

---

# Jokers of Neon - Event Listener

Bot para escuchar eventos `MissionCompletedEvent` desde Torii usando el patrón del ejemplo [dojo.js/example-node-worker](https://github.com/dojoengine/dojo.js/tree/main/examples/example-node-worker).

## Características

- ✅ Escucha eventos en tiempo real desde Torii
- ✅ Procesa eventos `MissionCompletedEvent`
- ✅ Modo solo lectura (sin ejecutar transacciones)
- ✅ Modo ejecución (ejecuta transacciones en Starknet)
- ✅ Soporte multi-chain para encolar y ejecutar escrituras en Celo
- ✅ Basado en el SDK oficial de Dojo.js

## Instalación

```bash
cd event-listener
bun install
```

## Configuración

1. Copia el archivo de ejemplo de variables de entorno:
   ```bash
   cp .env.example .env
   ```

2. Edita `.env` con tu configuración:

```env
# Controla qué slot instance y manifest cargar.
# Valores comunes hoy: dev | prods3
# Slot RPC, Torii URL, Relay URL, World Address y Game View contract
# se resuelven dinámicamente desde version.json y manifest remoto.
MANIFEST_SLOT_ENV=dev

# Opcional (para ejecutar transacciones)
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_PRIVATE_KEY=0x...
STARKNET_ADDRESS=0x...

# Opcional (para ejecutar escrituras EVM en Celo)
# En este worker Celo siempre usa mainnet.
# En Celo el worker usa un unico contrato: Profile.
CELO_RPC_URL=https://forno.celo.org
CELO_PRIVATE_KEY=0x...
CELO_ADDRESS=0x...
CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS=0x...
WORKER_BLOCKCHAIN_FILTER=starknet,celo
```

`WORKER_BLOCKCHAIN_FILTER` acepta una lista separada por comas, por ejemplo `starknet,celo` o `celo`.
Filtra qué filas de `torii_worker_transaction_queue` procesa esta instancia del worker. No cambia qué eventos llegan desde Torii; eso ya depende de `MANIFEST_SLOT_ENV`.

## Uso

### Modo Desarrollo

```bash
bun run dev
```

### Modo Producción

```bash
# Compilar
bun run build

# Ejecutar
bun run start
```

## Modos de Operación

### Modo Solo Lectura

Si **NO** configuras `STARKNET_PRIVATE_KEY`, el bot funcionará en modo solo lectura:
- Escucha eventos en tiempo real
- Muestra los eventos en la consola
- **NO ejecuta transacciones** en Starknet

### Modo Ejecución

Si configuras `STARKNET_PRIVATE_KEY` y las demás variables de Starknet:
- Escucha eventos en tiempo real
- Muestra los eventos en la consola
- **Ejecuta transacciones** en Starknet para procesar recompensas

## Estructura del Proyecto

```
event-listener/
├── src/
│   ├── main.ts              # Worker principal (basado en ejemplo de dojo.js)
│   ├── env.ts               # Configuración de variables de entorno
│   ├── dojoConfig.ts        # Configuración de Dojo
│   ├── eventListener.ts     # Lógica legacy de escucha de eventos
│   ├── starknetExecutor.ts  # Ejecutor de transacciones en Starknet
│   └── schema.ts            # Schemas generados (placeholder)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Generar Schemas TypeScript (Opcional)

Si tienes acceso al proyecto de Cairo/Dojo, puedes generar los schemas TypeScript:

1. Ve al proyecto de Dojo de Jokers of Neon
2. Ejecuta:
   ```bash
   sozo build
   dojo-bindgen typescript --outputPath ../event-listener/typescript
   ```
3. Esto generará los schemas en la carpeta `typescript/`

**Nota**: El worker funciona sin los schemas generados, pero tenerlos proporciona mejor type safety.

## Logs de Ejemplo

```
🎮 Jokers of Neon - Event Listener
════════════════════════════════════════════════════════════
Torii URL:    https://api.cartridge.gg/x/jokers-pre-season/torii
Relay URL:    https://api.cartridge.gg/x/jokers-pre-season/torii
World:        0x...
════════════════════════════════════════════════════════════

🔌 Inicializando SDK de Dojo...

✅ SDK inicializado correctamente

🚀 Configurando listeners de eventos...

📊 Eventos históricos iniciales: 5

📜 Eventos históricos encontrados:
   1. Player: 0x123..., Mission: 0x1
   2. Player: 0x456..., Mission: 0x2

📡 Suscribiéndose a eventos en tiempo real...

✅ Listener configurado exitosamente

👂 Escuchando eventos MissionCompletedEvent...

Presiona Ctrl+C para detener
```

## Troubleshooting

### Error: "Slot config not loaded" o "Manifest not loaded"
Asegúrate de que `MANIFEST_SLOT_ENV` esté configurado en tu `.env` y que el servicio pueda acceder a `jokersofneon.com` para cargar `version.json` y el manifest remoto.

### El bot no escucha eventos
- Verifica que `MANIFEST_SLOT_ENV` apunte al entorno correcto (`dev`, `prods3` u otro alias válido presente en `version.json`)
- Revisa los logs de startup para confirmar que Torii URL y World Address se resolvieron correctamente
- Asegúrate de que el modelo de evento esté correctamente nombrado en el código

## Referencias

- [Dojo.js Documentation](https://book.dojoengine.org/toolchain/dojo-js)
- [Example Node Worker](https://github.com/dojoengine/dojo.js/tree/main/examples/example-node-worker)
- [Torii Documentation](https://book.dojoengine.org/toolchain/torii)


## Unified worker (cron + agent + torii)

Entry point: `src/index.ts` — one process for Torii, queue, crons, notifications, and agent.

See `.env.example` for module flags. Mission generation enqueues `missions.generate_daily` and `missions.generate_weekly` (weekly was missing from the old cron repo).

Test on staging (`MANIFEST_SLOT_ENV` for test slot) before prod cutover.
