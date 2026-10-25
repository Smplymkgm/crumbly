/**
 * Crumbly — compresión de comprobantes en el navegador antes de subirlos.
 *
 * Las fotos del celular pesan varios MB; subirlas así por datos móviles en
 * la caja es lento y llena Drive. Acá se achican ANTES de pasarlas a base64.
 *
 * Un solo perfil, el de comprobantes, y conservador: es un documento que se
 * tiene que poder leer (monto, referencia, fecha). Lado mayor 2000 px y
 * JPEG 0.85 dejan legible el texto de capturas de banco y fotos de papel.
 * No hay perfil de fotos de producto porque la app ya no sube fotos de
 * producto; si vuelven, ahí va un perfil más fuerte (~1200 px).
 *
 * Reglas:
 * - Nunca tira: ante cualquier problema devuelve el archivo original. La
 *   validación de tipo y tamaño del servidor (Code.gs) sigue siendo la
 *   defensa real.
 * - PDF, GIF y lo que no sea imagen pasan tal cual.
 * - createImageBitmap con imageOrientation 'from-image' aplica la rotación
 *   EXIF (si no, la foto vertical del celular sale acostada). Si el
 *   navegador no puede decodificar (HEIC en Chrome/Windows, archivo roto)
 *   se sube el original.
 * - Nunca agranda, y si el resultado pesa lo mismo o más, va el original.
 * - PNG/WebP con transparencia: WebP 0.9 (o PNG si no hay WebP); pasarlo a
 *   JPEG le pondría fondo negro.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.CrumblyImagenes = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PERFIL_COMPROBANTE = { ladoMax: 2000, calidad: 0.85, calidadTransparente: 0.9 };
  var EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  // El comprimido solo si existe, tiene algo y pesa estrictamente menos.
  function decidirResultado(original, comprimido) {
    if (!comprimido || !(comprimido.size > 0)) return original;
    return comprimido.size < original.size ? comprimido : original;
  }

  // Recorre TODO el canal alfa (un solo píxel transparente cuenta). Sobre
  // la imagen ya achicada (≤ 2000 px) son unos milisegundos.
  function tieneTransparencia(imageData) {
    var data = imageData && imageData.data;
    if (!data || !data.length) return false;
    for (var i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) return true;
    }
    return false;
  }

  // Lado mayor ≤ ladoMax, misma proporción, nunca agranda.
  function medidasDestino(ancho, alto, ladoMax) {
    var escala = Math.min(1, ladoMax / Math.max(ancho, alto));
    return {
      ancho: Math.max(1, Math.round(ancho * escala)),
      alto: Math.max(1, Math.round(alto * escala))
    };
  }

  function nombreConExtension(nombre, tipo) {
    var base = String(nombre || '').replace(/\.[^./\\]*$/, '') || 'comprobante';
    return base + '.' + (EXTENSION[tipo] || 'jpg');
  }

  function avisar(opts, etapa) {
    try { if (opts && typeof opts.onProgreso === 'function') opts.onProgreso(etapa); } catch (e) { /* el aviso no frena la compresión */ }
  }

  function crearCanvas(ancho, alto) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(ancho, alto);
    var c = document.createElement('canvas');
    c.width = ancho;
    c.height = alto;
    return c;
  }

  function codificar(canvas, tipo, calidad) {
    if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: tipo, quality: calidad });
    return new Promise(function (resolve) { canvas.toBlob(resolve, tipo, calidad); });
  }

  async function comprimirComprobante(file, opts) {
    try {
      var tipo = String((file && file.type) || '').toLowerCase();
      if (!/^image\//.test(tipo) || tipo === 'image/gif') return file;
      if (typeof createImageBitmap !== 'function') return file;
      avisar(opts, 'comprimiendo');

      var perfil = PERFIL_COMPROBANTE;
      var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      var m = medidasDestino(bitmap.width, bitmap.height, perfil.ladoMax);
      var canvas = crearCanvas(m.ancho, m.alto);
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, m.ancho, m.alto);
      if (typeof bitmap.close === 'function') bitmap.close();

      var blob;
      var puedeTenerAlfa = tipo === 'image/png' || tipo === 'image/webp';
      if (puedeTenerAlfa && tieneTransparencia(ctx.getImageData(0, 0, m.ancho, m.alto))) {
        blob = await codificar(canvas, 'image/webp', perfil.calidadTransparente);
        // Sin WebP el navegador devuelve PNG (que conserva el alfa).
        if (!blob || blob.type !== 'image/webp') blob = await codificar(canvas, 'image/png');
      } else {
        blob = await codificar(canvas, 'image/jpeg', perfil.calidad);
      }

      var resultado = file;
      if (blob && EXTENSION[blob.type]) {
        var comprimido = new File([blob], nombreConExtension(file.name, blob.type), { type: blob.type, lastModified: Date.now() });
        resultado = decidirResultado(file, comprimido);
      }
      avisar(opts, 'listo');
      return resultado;
    } catch (e) {
      avisar(opts, 'listo');
      return file;
    }
  }

  return {
    PERFIL_COMPROBANTE: PERFIL_COMPROBANTE,
    decidirResultado: decidirResultado,
    tieneTransparencia: tieneTransparencia,
    medidasDestino: medidasDestino,
    nombreConExtension: nombreConExtension,
    comprimirComprobante: comprimirComprobante
  };
});
