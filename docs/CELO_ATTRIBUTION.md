# Atribución de transacciones de Jokers en Celo

Código asignado: `celo_zni2b7n2`. Se utiliza literalmente; no se deriva otro código
del hostname o repositorio y no se agregan códigos de plataformas.

## Alcance de esta integración

- Cola de Profile, progresión, estadísticas y transferencias de premios:
  `src/transactionExecutors/celoTransactionExecutor.ts`.
- Settlement V2 de NFTs, protocolos `mint-reward-v1` y `mint-cards-v1`:
  `src/v2/settlement/evm.ts`.
- Suffix ERC-8021 generado con `@celo/attribution-tags`, centralizado en
  `src/utils/celoAttribution.ts` para Celo Mainnet (42220) y Celo Sepolia (11142220).
- Los bytes se agregan antes de simular, estimar gas y firmar. El envío de la
  transacción firmada y los reintentos conservan exactamente los mismos bytes.
- Settlement también acepta el calldata original exacto para poder observar y
  retransmitir submissions firmadas antes de este cambio. Otros suffixes o
  cambios de argumentos no pasan su validación.
- Otras redes EVM y Starknet/Katana conservan su calldata.

La integración mantiene los firmantes, permisos, contratos, frontend, esquema de
base de datos y procesamiento de colas actuales. El tag atribuye actividad a la
app; no cambia el remitente ni convierte beneficiarios en wallets firmantes.
Los bytes adicionales pueden modificar la comisión de la transacción.

## Instalación y validación

Instalar las dependencias con el lockfile del repositorio y desplegar el worker
habitual. No requiere migraciones ni nuevas variables de configuración.

Pruebas offline:

```sh
bun test tests/celoAttributionQueue.test.ts tests/v2/celoAttribution.test.ts tests/v2/solidityCards.test.ts
bun run build
```

Después del despliegue, tomar el hash de una transacción exitosa de cada camino
activo (cola de Profile/transferencias y settlement V2) y verificarlo:

```sh
CELO_RPC_URL=https://forno.celo.org bun run verify:celo-attribution 0x<HASH_DE_64_HEX>
```

Para Sepolia usar un RPC de Celo Sepolia. El comando es de solo lectura: comprueba
la red, decodifica con `verifyTx`, exige el código asignado y un receipt exitoso.
No carga `.env` automáticamente; pasar `CELO_RPC_URL` o exportarla en el shell.

Las pruebas automatizadas verifican transacciones firmadas con una clave pública
de prueba y un cliente RPC simulado. No prueban un despliegue real: la validación
on-chain queda pendiente hasta tener los hashes posteriores al despliegue.

## Referencias

- [Guía de Celo](https://github.com/celo-org/attribution-tags/blob/main/BUILDERS.md)
- [SDK](https://github.com/celo-org/attribution-tags/blob/main/sdk/README.md)
- [Idea futura de ejecución con cuentas de jugadores](USER_WALLET_EXECUTION_PROPOSAL.md)
