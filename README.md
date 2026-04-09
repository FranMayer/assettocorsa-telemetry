# PITWALL — Telemetría Assetto Corsa

Dashboard de telemetría en tiempo real para Assetto Corsa, diseñado para iPad.

```
PC (Assetto Corsa) → UDP :9996 → server.js → WebSocket → iPad (browser)
```

## Requisitos

- Node.js 18+
- PC y iPad en la misma red WiFi

## Instalación

```bash
npm install
```

## Arrancar el servidor

```bash
npm start
```

Al arrancar verás algo así en consola:

```
╔══════════════════════════════════════════════╗
║           PITWALL — Telemetría AC            ║
╠══════════════════════════════════════════════╣
║  Dashboard: http://192.168.1.42:3000         ║
║  UDP puerto: 9996 (Assetto Corsa)            ║
╚══════════════════════════════════════════════╝
```

Escribe esa URL en el Safari del iPad.

## Configurar Assetto Corsa

Edita el archivo:

```
Documents\Assetto Corsa\cfg\assetto_corsa.ini
```

Busca (o añade) la sección `[REMOTE]` y pon:

```ini
[REMOTE]
APP_UDP_PORT=9996
```

Guarda y arranca una sesión en AC. Los datos deberían fluir de inmediato.

> Si no existe el archivo, créalo. Si la sección `[REMOTE]` no existe, añádela al final.

## Dashboard

| Zona | Qué muestra |
|------|-------------|
| Barra superior | RPM — verde → amarillo → rojo. Parpadea rojo al pasar 7000 rpm |
| Izquierda | Marcha actual (enorme), barra de gas (verde), barra de freno (rojo) |
| Centro | Velocidad en KM/H |
| Derecha | Vuelta actual / Mejor vuelta (dorado) / Última vuelta |
| Inferior | Temperatura de neumáticos FL FR RL RR (azul=frío, verde=óptimo, rojo=caliente) |
| Esquina sup-der | Punto verde = datos OK / rojo parpadeando = sin señal |

## Estructura

```
pitwall/
├── server.js        ← UDP + WebSocket + Express
├── public/
│   └── index.html   ← Dashboard (HTML+CSS+JS todo en uno)
├── package.json
└── README.md
```
