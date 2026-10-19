/* 靜態普隆德拉 3D 場景渲染器：WebGL 1，不使用外部 CDN。 */
(function exposeRoProntera3D(root) {
  'use strict';

  const SCENE_URL = 'data/maps/prontera-scene.json';
  const TEXTURE_ROOT = 'images/maps/prontera/textures/';
  const MAP_SIZE = 104;
  const MAP_HALF = 51.5;
  const MAP_SPAN = MAP_SIZE - 1;
  const SIN_ELEVATION = Math.SQRT1_2;
  const COS_ELEVATION = Math.SQRT1_2;
  const CAMERA_DISTANCE = 198;
  let instance = null;
  let generation = 0;
  let failed = false;
  let toastShown = false;

  function assetUrl(path) {
    return new URL(path, root.document.baseURI).href;
  }

  function cameraMetrics(width, height) {
    const aspect = Math.max(0.25, Number(width) / Math.max(1, Number(height)));
    const halfHeight = Math.max(54, 57 / aspect);
    return { aspect, halfHeight, halfWidth: halfHeight * aspect };
  }

  function projectPlanePoint(worldX, worldZ, width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0) || !(h > 0) || !Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
    const metrics = cameraMetrics(w, h);
    const ndcX = worldX / metrics.halfWidth;
    const ndcY = -worldZ * SIN_ELEVATION / metrics.halfHeight;
    return { x: (ndcX + 1) * w / 2, y: (1 - ndcY) * h / 2 };
  }

  function screenToWorld(clientX, clientY, rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const metrics = cameraMetrics(rect.width, rect.height);
    const worldX = nx * metrics.halfWidth;
    const worldZ = -ny * metrics.halfHeight / SIN_ELEVATION;
    if (worldX < -52 || worldX > 52 || worldZ < -52 || worldZ > 52) return null;
    return { x: worldX, z: worldZ };
  }

  function projectExplorationPosition(x, y, width, height) {
    const rx = (Number(x) - 7) / 86;
    const rz = (Number(y) - 14) / 70;
    const worldX = rx * MAP_SPAN - MAP_HALF;
    const worldZ = rz * MAP_SPAN - MAP_HALF;
    return projectPlanePoint(worldX, worldZ, width, height);
  }

  function screenToExplorationPosition(clientX, clientY, rect) {
    const world = screenToWorld(clientX, clientY, rect);
    if (!world) return null;
    return {
      x: 7 + ((world.x + MAP_HALF) / MAP_SPAN) * 86,
      y: 14 + ((world.z + MAP_HALF) / MAP_SPAN) * 70
    };
  }

  function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4]
          + a[4 + row] * b[col * 4 + 1]
          + a[8 + row] * b[col * 4 + 2]
          + a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function buildMvp(width, height) {
    const metrics = cameraMetrics(width, height);
    const near = 0.1;
    const far = 500;
    const projection = new Float32Array([
      1 / metrics.halfWidth, 0, 0, 0,
      0, 1 / metrics.halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1
    ]);
    // 相機從普隆德拉南側略高處觀看；RO 模型的 Y 軸朝向與 WebGL 相反。
    const view = new Float32Array([
      1, 0, 0, 0,
      0, COS_ELEVATION, SIN_ELEVATION, 0,
      0, -SIN_ELEVATION, COS_ELEVATION, 0,
      0, 0, -CAMERA_DISTANCE, 1
    ]);
    return multiplyMat4(projection, view);
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL 無法建立著色器。');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
      gl.deleteShader(shader);
      throw new Error('普隆德拉著色器編譯失敗：' + message);
    }
    return shader;
  }

  function buildProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 aPosition; attribute vec2 aUv; uniform mat4 uMvp; varying vec2 vUv;'
      + 'void main(){ vec3 p=aPosition; p.y=-p.y; gl_Position=uMvp*vec4(p,1.0); vUv=aUv; }');
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; uniform sampler2D uTexture; varying vec2 vUv;'
      + 'void main(){ vec4 c=texture2D(uTexture,vUv); if(c.a<0.12) discard; gl_FragColor=c; }');
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL 無法建立繪圖程式。');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('普隆德拉 WebGL 程式連結失敗：' + (gl.getProgramInfoLog(program) || 'unknown error'));
    }
    return program;
  }

  function createBuffer(gl, target, data) {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('WebGL 顯示記憶體不足。');
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  }

  function createMeshResources(gl, source) {
    if (!source || !Array.isArray(source.positions) || !Array.isArray(source.uvs)
      || !Array.isArray(source.indices) || source.positions.length % 3
      || source.uvs.length !== source.positions.length / 3 * 2
      || source.positions.length / 3 > 65535) {
      throw new Error('普隆德拉網格資料格式不合法。');
    }
    let maxIndex = 0;
    for (const index of source.indices) {
      if (!Number.isInteger(index) || index < 0 || index >= source.positions.length / 3) {
        throw new Error('普隆德拉網格索引超出範圍。');
      }
      if (index > maxIndex) maxIndex = index;
    }
    if (maxIndex > 65535) throw new Error('普隆德拉網格超過 WebGL 1 索引上限。');
    return {
      texture: source.texture,
      position: createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(source.positions)),
      uv: createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(source.uvs)),
      index: createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(source.indices)),
      indexCount: source.indices.length
    };
  }

  function makeFallbackTexture(gl) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([108, 105, 100, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  function loadTexture(gl, filename, fallback) {
    return new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        try {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          resolve({ texture, failed: false });
        } catch (error) {
          resolve({ texture: fallback, failed: true });
        }
      };
      image.onerror = () => resolve({ texture: fallback, failed: true });
      image.src = assetUrl(TEXTURE_ROOT + encodeURIComponent(filename));
    });
  }

  function draw(instance) {
    if (!instance || instance.disposed) return false;
    const rect = instance.scene.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return false;
    const dpr = Math.min(1.5, Math.max(1, Number(root.devicePixelRatio) || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (instance.canvas.width !== width || instance.canvas.height !== height) {
      instance.canvas.width = width;
      instance.canvas.height = height;
    }

    const gl = instance.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.055, 0.075, 0.10, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(instance.program);
    gl.uniformMatrix4fv(instance.mvpLocation, false, buildMvp(rect.width, rect.height));
    gl.uniform1i(instance.textureLocation, 0);

    for (const mesh of instance.meshes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
      gl.enableVertexAttribArray(instance.positionLocation);
      gl.vertexAttribPointer(instance.positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
      gl.enableVertexAttribArray(instance.uvLocation);
      gl.vertexAttribPointer(instance.uvLocation, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, instance.textures[mesh.texture] || instance.fallbackTexture);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }

    if (!instance.ready) {
      instance.ready = true;
      instance.canvas.style.visibility = 'visible';
      instance.panel.classList.add('has-prontera-3d');
      instance.scene.classList.add('ro-prontera-3d');
      if (typeof root.renderRoExplorationPosition === 'function') root.renderRoExplorationPosition();
      if (!toastShown && typeof root.showToast === 'function') {
        root.showToast('普隆德拉 3D 場景已載入。');
        toastShown = true;
      }
    }
    return true;
  }

  function destroyInstance() {
    generation++;
    const old = instance;
    instance = null;
    if (old) {
      old.disposed = true;
      if (old.resizeObserver) old.resizeObserver.disconnect();
      if (old.onResize && root.removeEventListener) root.removeEventListener('resize', old.onResize);
      if (old.panel) old.panel.classList.remove('has-prontera-3d');
      if (old.scene) old.scene.classList.remove('ro-prontera-3d');
      if (old.canvas && old.canvas.parentNode) old.canvas.parentNode.removeChild(old.canvas);
    }
    if (root.document && typeof root.renderRoExplorationPosition === 'function') {
      root.renderRoExplorationPosition();
    }
  }

  async function mount(panel, scene) {
    if (instance && instance.panel === panel && instance.scene === scene) {
      draw(instance);
      return;
    }
    destroyInstance();
    failed = false;
    const token = ++generation;
    const canvas = root.document.createElement('canvas');
    canvas.className = 'ro-prontera-3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.visibility = 'hidden';
    canvas.style.pointerEvents = 'none';
    scene.appendChild(canvas);

    let gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'low-power' })
        || canvas.getContext('experimental-webgl', { alpha: true, antialias: true });
      if (!gl) throw new Error('此瀏覽器不支援 WebGL。');
      const program = buildProgram(gl);
      const fallbackTexture = makeFallbackTexture(gl);
      const current = {
        panel, scene, canvas, gl, program, fallbackTexture, meshes: [], textures: [],
        ready: false, disposed: false, resizeObserver: null, onResize: null,
        positionLocation: gl.getAttribLocation(program, 'aPosition'),
        uvLocation: gl.getAttribLocation(program, 'aUv'),
        mvpLocation: gl.getUniformLocation(program, 'uMvp'),
        textureLocation: gl.getUniformLocation(program, 'uTexture')
      };
      instance = current;
      if (typeof root.ResizeObserver === 'function') {
        current.resizeObserver = new root.ResizeObserver(() => draw(current));
        current.resizeObserver.observe(scene);
      } else if (root.addEventListener) {
        current.onResize = () => draw(current);
        root.addEventListener('resize', current.onResize);
      }

      const response = await root.fetch(assetUrl(SCENE_URL));
      if (!response || !response.ok) throw new Error('普隆德拉 3D 網格載入失敗。');
      const data = await response.json();
      if (data.version !== 1 || data.map !== 'prontera' || data.size !== MAP_SIZE
        || !Array.isArray(data.meshes) || data.meshes.length !== data.textures.length
        || data.meshes.length > 500) {
        throw new Error('普隆德拉 3D 網格資料不完整。');
      }
      current.meshes = data.meshes.map(mesh => createMeshResources(gl, mesh));
      const loaded = await Promise.all(data.textures.map(filename => loadTexture(gl, filename, fallbackTexture)));
      if (token !== generation || instance !== current || current.disposed) return;
      current.textures = loaded.map(entry => entry.texture);
      const failedCount = loaded.filter(entry => entry.failed).length;
      if (failedCount && typeof root.showToast === 'function') {
        root.showToast('普隆德拉有 ' + failedCount + ' 張貼圖載入失敗，已使用備用材質。');
      }
      draw(current);
    } catch (error) {
      if (token !== generation) return;
      failed = true;
      destroyInstance();
      if (typeof root.showToast === 'function') {
        root.showToast('3D 地圖載入失敗，暫時使用預覽圖。');
      }
    }
  }

  function refresh() {
    const doc = root.document;
    if (!doc || typeof doc.querySelector !== 'function') return;
    const panel = doc.querySelector('.battle-panel.has-prontera-map');
    const scene = doc.getElementById('battle-scene');
    if (!panel || !scene) {
      if (instance) destroyInstance();
      failed = false;
      return;
    }
    if (failed) return;
    mount(panel, scene);
  }

  function installHook() {
    const original = root.renderMapBackground;
    if (typeof original !== 'function' || original.__roProntera3DWrapped) return;
    const wrapped = function () {
      const result = original.apply(this, arguments);
      refresh();
      return result;
    };
    wrapped.__roProntera3DWrapped = true;
    root.renderMapBackground = wrapped;
  }

  root.ROProntera3D = Object.freeze({
    isActive: () => !!(instance && instance.ready && !instance.disposed),
    projectPlanePoint,
    projectExplorationPosition,
    screenToExplorationPosition,
    refresh
  });

  installHook();
  if (root.document && root.document.readyState === 'loading'
    && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('DOMContentLoaded', () => { installHook(); refresh(); }, { once: true });
  } else {
    refresh();
  }
})(typeof window !== 'undefined' ? window : globalThis);
