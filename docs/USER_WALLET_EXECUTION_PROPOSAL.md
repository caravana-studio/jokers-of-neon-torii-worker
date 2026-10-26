# Propuesta: ejecución diferida desde cuentas de jugadores

Fecha: 2026-10-26. Estado: idea acordada para investigar; implementación futura.
Este documento preserva el contexto para retomar el trabajo. La branch de
atribución implementa solamente el tag de Celo.

## Objetivo del producto

Conservar Katana en AWS, la ingestión de eventos, la base de datos y la cola de
operaciones. Permitir que las operaciones de Celo se ejecuten mediante cuentas de
los jugadores, con autorización previa y sin pedir confirmación por cada claim.
La ejecución debe poder continuar cuando el jugador cierre la app.

El usuario acepta mantener un ejecutor en segundo plano. La intención es que ese
ejecutor utilice permisos de las cuentas de los jugadores, en lugar de que toda
operación sea una llamada directa desde una única cuenta operadora.

## Situación observada

- Profile se actualiza mediante una cuenta operadora; sus escrituras Solidity
  requieren `onlyOwner`.
- Settlement V2 prepara, firma, persiste y transmite transacciones del ejecutor.
  `mintCards` exige un operador autorizado por el PermissionSystem.
- Las direcciones de beneficiarios/jugadores ya aparecen en datos y eventos.
- No existe un dashboard concreto aportado por el usuario que defina wallets
  activas. El problema planteado es que mirar remitentes de transacciones en un
  explorer refleja al operador y no toda la tracción del juego.
- El tag `celo_zni2b7n2` atribuye transacciones a Jokers, pero no cambia firmantes.

## Mecanismo a evaluar

Una transacción prefirmada fija calldata, nonce, red y comisiones. Sirve cuando la
operación ya es conocida, pero no autoriza genéricamente recompensas futuras.

Para resultados que todavía no existen, evaluar una smart account con permisos
de sesión o una wallet que soporte delegación compatible. El jugador concede una
autorización inicial, limitada y revocable, y una clave delegada firma operaciones
posteriores. El contrato de la cuenta debe verificar esos permisos on-chain.

```text
Frontend: jugador autoriza la sesión y vincula su cuenta
                         ↓
Katana → eventos → base de datos → cola de operaciones
                                        ↓
                       backend valida el resultado/recompensa
                                        ↓
                       ejecutor usa un permiso de sesión vigente
                                        ↓
                       cuenta del jugador → contrato de claim en Celo
```

Para claims, el backend emitiría una autorización de recompensa verificable por
el contrato: operación, red, contrato, destinatario y contenido exacto, con uso
único y una política de vencimiento definida. La autorización de sesión permite
actuar por el jugador; no prueba que haya ganado una recompensa.

## Requisitos para la futura implementación

- Frontend: vincular la cuenta, solicitar autorización inicial, mostrar su
  alcance/vigencia, permitir renovar y revocar. No pedir una firma por cada claim
  mientras el permiso sea válido.
- Persistir la autorización de sesión y sus restricciones; proteger la clave
  delegada que necesita el ejecutor para operar con el usuario desconectado.
  La clave principal del usuario permanece en su wallet.
- Restringir red, contratos, métodos, destinatarios, plazo y presupuesto de gas.
  Excluir transferencias arbitrarias, aprobaciones generales y permisos de mint
  ilimitados para jugadores.
- Conservar idempotencia, nonces, reintentos, persistencia antes del envío,
  reconciliación de receipts y manejo de reorganizaciones.
- Adaptar contratos de claim/permisos: no basta con cambiar el firmante en el SDK.
- Establecer quién patrocina el gas y límites de patrocinio. ERC-4337 introduce
  bundler y posiblemente paymaster aunque se conserve nuestro ejecutor.
- Incorporar el tag de Jokers antes de firmar las nuevas operaciones.

## Incertidumbres que deben resolverse primero

1. MiniPay: comprobar autorización/delegación en las versiones Android/iOS
   utilizadas. La guía técnica de Celo consultada indica que `personal_sign` y
   `eth_signTypedData` no están soportados. No asumir compatibilidad con session
   keys ni EIP-7702 por el solo hecho de usar Celo.
2. Dirección: decidir si se exige conservar la dirección MiniPay actual o se
   acepta una smart account asociada al jugador; ambas identidades son distintas.
   Definir también a qué dirección se entregan los NFTs.
3. Métricas: con ERC-4337, `tx.from` identifica al bundler; contar jugadores exige
   leer el `sender` de UserOperations o eventos adecuados. La arquitectura no
   garantiza aumentar un contador que solo mire remitentes exteriores.
4. Alcance: comenzar por claims de recompensas/NFTs. Evaluar por separado las
   escrituras administrativas de Profile y otros tipos de operaciones.
5. Revocación/expiración: definir qué ocurre con operaciones pendientes y cómo
   se solicita una nueva autorización sin duplicar recompensas.

## Primer experimento propuesto

En testnet, autorizar una sesión, cerrar la app y ejecutar un claim desde el
backend usando ese permiso. Confirmar destinatario, identidad de la cuenta,
patrocinio y tag. Verificar que un segundo claim de la misma recompensa, un
destinatario distinto, una firma inválida o un permiso expirado/revocado fallen.
Elegir proveedor y estimar la migración después de demostrar compatibilidad.

## Referencias

- [Session keys y delegación](https://docs.erc4337.io/smart-accounts/session-keys-and-delegation.html)
- [ERC-4337, bundlers y paymasters](https://docs.erc4337.io/core-standards/erc-4337.html)
- [Guía técnica de MiniPay de Celo](https://github.com/celo-org/celopedia-skills/blob/main/skills/celopedia-skill/references/minipay-guide.md)
- [Indexación de atribución de Celo](https://github.com/celo-org/attribution-tags/blob/main/INDEXERS.md)
