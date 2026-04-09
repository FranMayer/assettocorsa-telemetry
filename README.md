# PITWALL — Telemetría en vivo para Assetto Corsa

Servidor en **Node.js** que se conecta al protocolo **UDP Remote Telemetry** de Assetto Corsa, interpreta los paquetes de coche y vueltas, y reenvía el estado en tiempo real a un **dashboard web** por **WebSocket**. La interfaz (`public/index.html`) muestra marcha, velocidad, RPM, barra tipo shift light, tiempos de vuelta, acelerador y freno, pensada para pantallas tipo iPad en horizontal.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior (recomendado LTS).
- **Assetto Corsa** en el mismo PC que ejecuta este servidor (el código asume `127.0.0.1` para hablar con el juego).
- **Remote Telemetry** activado (en **Content Manager**: *Settings → General* → habilitar telemetría remota / UDP según tu versión).
- En **Windows**, que el firewall permita **UDP entrante** en el puerto **9997** (el propio `server.js` intenta crear una regla; si falla, créala a mano).

## Instalación

```bash
cd assettocorsa-telemetry
npm install
```

Si aún no tienes el código, clona el repositorio o descomprime el ZIP y usa la carpeta raíz del proyecto en lugar de `assettocorsa-telemetry`.

No hace falta un paso de build: el frontend es HTML/CSS/JS estático en `public/`.

## Uso

1. Arranca **Assetto Corsa** y entra en pista (o al menú donde el juego ya envíe telemetría, según tu configuración).
2. En la carpeta del proyecto:

   ```bash
   npm start
   ```

   Equivale a `node server.js`.

3. En la consola verás la URL del dashboard (por defecto **http://&lt;tu-IP-LAN&gt;:3000**). Ábrela en el navegador del PC o del iPad en la misma red.

El cliente WebSocket se reconecta solo si se corta la conexión.

## Puertos

| Puerto | Uso |
|--------|-----|
| **3000** | HTTP (página del dashboard) y **WebSocket** (`ws://host:3000`) |
| **9996** | UDP hacia Assetto Corsa (handshake / suscripción) |
| **9997** | UDP local: el servidor escucha aquí las respuestas y el stream del juego |

Si algo no llega, revisa firewall en **9997** UDP y que la telemetría remota esté activa en el juego.

## Estructura del proyecto

- `server.js` — Express, estáticos, WebSocket y cliente UDP al protocolo de AC.
- `public/index.html` — Dashboard (una sola página con estilos y lógica embebidos).

## Datos que envía el servidor al navegador

El JSON por WebSocket incluye, entre otros: `speed`, `rpms`, `gear`, `throttle`, `brake`, `lapTime`, `lastLap`, `bestLap`, `lapCount`. Los mensajes con `_lapCompleted` son eventos de vuelta completada y el dashboard los ignora en el renderizado principal.

## Licencia

Si el repositorio define una licencia en un archivo `LICENSE`, prevalece ese texto.
