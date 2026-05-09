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
# Controla qué slot instance y manifest cargar (dev | mainnet)
# Slot RPC, Torii URL, Relay URL, World Address y Game View contract
# se resuelven dinámicamente desde version.json y manifest remoto.
MANIFEST_SLOT_ENV=dev

# Opcional (para ejecutar transacciones)
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_PRIVATE_KEY=0x...
STARKNET_ADDRESS=0x...

# Opcional (para ejecutar escrituras EVM en Celo Sepolia)
# Si usas un contrato unificado, puedes repetir la misma address en XP/Profile/Progression.
CELO_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
CELO_PRIVATE_KEY=0x...
CELO_ADDRESS=0x...
CELO_XP_SYSTEM_CONTRACT_ADDRESS=0x...
CELO_PROFILE_SYSTEM_CONTRACT_ADDRESS=0x...
CELO_PROGRESSION_SYSTEM_CONTRACT_ADDRESS=0x...
WORKER_BLOCKCHAIN_FILTER=celo
```

`WORKER_BLOCKCHAIN_FILTER=celo` hace que este worker procese solo filas `celo` de `torii_worker_transaction_queue`, útil cuando compartes la misma cola con otro worker de Starknet.

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
- Verifica que `MANIFEST_SLOT_ENV` apunte al entorno correcto (`dev` o `mainnet`)
- Revisa los logs de startup para confirmar que Torii URL y World Address se resolvieron correctamente
- Asegúrate de que el modelo de evento esté correctamente nombrado en el código

## Referencias

- [Dojo.js Documentation](https://book.dojoengine.org/toolchain/dojo-js)
- [Example Node Worker](https://github.com/dojoengine/dojo.js/tree/main/examples/example-node-worker)
- [Torii Documentation](https://book.dojoengine.org/toolchain/torii)
