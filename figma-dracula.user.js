// ==UserScript==
// @name         Figma Dracula (FigJam board)
// @namespace    rdj.xyz
// @version      1.0.1
// @description  Paints the FigJam board in Dracula colours. Companion to the "Figma Dracula" Stylus userstyle, which handles everything that is plain CSS.
// @author       rdj.xyz
// @match        https://www.figma.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
  WHY THIS EXISTS

  FigJam has no dark mode, and the board itself is not CSS: Figma's WebAssembly
  renderer draws it through WebGPU. Its dot-grid fragment shader takes a
  UniformBlock whose background is a single scalar grey
  (`dotBackgroundBaseColor` = 0.9608 = #F5F5F5) mixed with a dot grey, and the
  final swapchain frame is one full-screen composite of that scene texture.
  Clear colours, page colour, pipeline constants and textures are all
  irrelevant to the pixel you see, which is why a userstyle cannot touch it.

  Two small interventions, both from document-start so they are in place
  before the renderer initialises:

    1. createShaderModule: in the dot-grid fragment shader, the background term
       `vec3((grey*(1-alpha)))` becomes `vec3(grey)*TINT*(1-alpha)`. A scalar can
       only ever give neutral grey; the tint is what makes it Dracula's blue-black.
    2. queue.writeBuffer: the 112-byte grid UniformBlock (checkerboardStyle == 2
       is the dot grid) gets its greys lowered so grey*TINT lands on the palette:
       base -> #282A36, dots -> ~#3E4154.

  Content is untouched: the patch only changes the term that is multiplied by
  (1 - content alpha), i.e. the empty board. Both hooks are no-ops if Figma's
  shader text changes shape, so the worst case is the stock light board.

  Matched on all of figma.com, not just /board/: opening a board from the file
  browser is an in-app navigation with no page load, so the hooks must already
  be resident. They are inert until the FigJam grid shader shows up.

  Field offsets in the UniformBlock (bytes): gridTransform 0-47, pageColor 48-63,
  gridData 64-71, checkerboardStyle 72, unpremultiplyAlpha 76, alphaMultiplier 80,
  zoomScale 84, dotBackgroundBaseColor 88, dotBackgroundZoomedOutColor 92,
  dotColorDiff 96, padding 100-111.
*/
(() => {
  'use strict';
  if (!window.GPUDevice || GPUDevice.prototype.__drac) return;
  const D = { build: 'figma-dracula 1.0.1', shaderPatched: 0, shaderMissed: 0, uniformPatched: 0 };
  window.__figmaDracula = D;
  try { document.documentElement.setAttribute('data-figma-dracula', 'ran'); } catch (e) {}

  // Dracula background #282A36 = (40,42,54). The shader carries a scalar grey,
  // so grey is multiplied by this tint and the uniform greys are chosen so
  // grey * TINT lands on the palette.
  const TINT = [40 / 54, 42 / 54, 1];
  const BASE = 54 / 255;             // -> #282A36
  const DOT_ZOOMED_OUT = 84 / 255;   // -> ~#3E4154
  const DOT_DIFF = 6 / 255;          // dots creep to ~#42455A zoomed in
  const PAGE = [40 / 255, 42 / 255, 54 / 255];

  const Dv = GPUDevice.prototype, Q = GPUQueue.prototype;

  // 1. Shader: tint the background term of the dot-grid blend.
  {
    const o = Dv.createShaderModule;
    Dv.createShaderModule = function (d) {
      try {
        const code = String((d && d.code) || '');
        if (code.includes('dotBackgroundBaseColor') && code.includes('@fragment')) {
          const re = /vec3\(\((\w+)\*\(1f-(\w+)\.w\)\)\)\+(\w+)\.xyz/;
          if (re.test(code)) {
            const t = TINT.map(x => x.toFixed(4) + 'f').join(',');
            const patched = code.replace(re, (m, g, c, cc) => `(vec3(${g})*vec3(${t})*(1f-${c}.w))+${cc}.xyz`);
            D.shaderPatched++;
            return o.call(this, Object.assign({}, d, { code: patched }));
          }
          D.shaderMissed++;
        }
      } catch (e) { D.err = String(e); }
      return o.call(this, d);
    };
  }

  // 2. Uniforms: the 112-byte grid UniformBlock for the dot grid.
  {
    const o = Q.writeBuffer;
    Q.writeBuffer = function (buf, off, data, dOff, size) {
      try {
        let v;
        if (data instanceof ArrayBuffer) v = new Uint8Array(data, dOff || 0, size);
        else if (ArrayBuffer.isView(data)) { const bpe = data.BYTES_PER_ELEMENT || 1; v = new Uint8Array(data.buffer, data.byteOffset + (dOff || 0) * bpe, size !== undefined ? size * bpe : undefined); }
        if (v && v.byteLength === 112) {
          const dv = new DataView(v.buffer, v.byteOffset, 112);
          const style = dv.getInt32(72, true), base = dv.getFloat32(88, true), alpha = dv.getFloat32(60, true);
          if (style === 2 && base > 0.85 && alpha === 1) {
            dv.setFloat32(48, PAGE[0], true); dv.setFloat32(52, PAGE[1], true); dv.setFloat32(56, PAGE[2], true);
            dv.setFloat32(88, BASE, true); dv.setFloat32(92, DOT_ZOOMED_OUT, true); dv.setFloat32(96, DOT_DIFF, true);
            D.uniformPatched++;
          }
        }
      } catch (e) { D.err2 = String(e); }
      return o.call(this, buf, off, data, dOff, size);
    };
  }
  Dv.__drac = 1;
})();
