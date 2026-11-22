# Resultados v59 (22 nov 2026)

Reels profesionales: MP4 H.264 1080×1920 a 30 fps hecho cuadro por cuadro, 3 diseños, portada 3:4 y todo el texto dentro de la zona segura de Instagram.

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor; incluye `v59-reels.mjs`) | 953 de 953 |
| `pruebas/v59-reels.mjs` | 45 de 45 (MP4 caja por caja: orden ftyp/moov/mdat, índice que apunta a los datos, tamaños, cuadros clave cada 2 s, 20.000 s, 1080×1920, 30 fps exactos, avcC, ctts con desfases si el codificador reordena; firma sin el secreto y negada a un bazar sin permiso; portada como `cover_url`; H.264 `q_auto:good`; 13 direcciones ajenas rechazadas sin llegar a Instagram) |
| `pruebas/v59-navegador.py` (compu, celular y celular oscuro) | 47 de 47 (zona segura en 3 diseños × 3 tipos × 2 velocidades con nombres y marcas larguísimos; capas a escala; ffprobe: h264 1080×1920 30/1, 600 cuadros, 20 s; ffmpeg lo decodifica sin errores; el cuadro 8.5 s del video difiere 0.7 de la vista previa; portada 1080×1920; publicar sube video y portada; respaldo sin WebCodecs; cancelar) |
| v33, v34, v35, v36, v37, v38, v39, v40-xss, v41–v46, v48–v58 | sin fallas |
| Flujo de Reels con la política de seguridad (CSP) de `vercel.json` | sin bloqueos |

Notas: las pruebas de navegador se corrieron con el servidor de pruebas recién iniciado. v33 y v36 dependen de la hora en que arrancó el servidor (pagos abiertos y apartados de 10 minutos) y v43 de que las prendas de la ficha 9 sigan disponibles; corridas después de v35/v37 o con el servidor de hace más de una hora fallan por los datos, no por el código (solas y con el servidor nuevo pasan todas).
