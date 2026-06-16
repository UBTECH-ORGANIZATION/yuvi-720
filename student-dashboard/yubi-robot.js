/* =============================================================
 * YuviLab 720 · Yubi Robot for the Dashboard chat
 * Reuses the procedural Three.js model from the learner mapping.
 * Exposes window.YubiRobot.mount(container, { view, isActive })
 *   view: 'full'  → small floating robot (used as the chat launcher)
 *   view: 'head'  → tight framing on the head (used in the chat header)
 * The head follows the mouse anywhere on the page, so it feels like
 * Yubi is always present and watching over the child.
 * ============================================================= */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Shared cursor position in normalized coords (-1..1).
const pointer = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
});

function makeRobot() {
    const g = new THREE.Group();
    const robot = new THREE.Group();
    g.add(robot);

    const whiteMat   = new THREE.MeshStandardMaterial({ color: 0xfdfdff, roughness: 0.6,  metalness: 0.06 });
    const purpleMat  = new THREE.MeshStandardMaterial({ color: 0x8b6dff, roughness: 0.45, metalness: 0.1 });
    const faceMat    = new THREE.MeshStandardMaterial({ color: 0x23204a, roughness: 0.3,  metalness: 0.2 });

    const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x53e6da, emissive: 0x4cc9f0, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.05 });
    const smileMat = new THREE.MeshStandardMaterial({ color: 0x53e6da, emissive: 0x4cc9f0, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.05 });
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // ===== Feet =====
    const footL = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.24, 4, 0.05), purpleMat);
    footL.position.set(-0.14, 0.05, 0.03);
    robot.add(footL);
    const footR = footL.clone(); footR.position.x = 0.14; robot.add(footR);

    // ===== Legs =====
    const legGeo = new RoundedBoxGeometry(0.15, 0.34, 0.17, 4, 0.07);
    const legL = new THREE.Mesh(legGeo, whiteMat);
    legL.position.set(-0.14, 0.28, 0);
    robot.add(legL);
    const legR = legL.clone(); legR.position.x = 0.14; robot.add(legR);
    const kneeGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.16, 16);
    const kneeL = new THREE.Mesh(kneeGeo, purpleMat); kneeL.rotation.z = Math.PI / 2; kneeL.position.set(-0.14, 0.2, 0); robot.add(kneeL);
    const kneeR = kneeL.clone(); kneeR.position.x = 0.14; robot.add(kneeR);

    // ===== Body =====
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.56, 0.36, 6, 0.13), whiteMat);
    body.position.y = 0.76;
    robot.add(body);
    const waist = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.1, 0.32, 4, 0.04), purpleMat);
    waist.position.y = 0.52;
    robot.add(waist);
    const chest = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.2, 0.03, 4, 0.06), faceMat);
    chest.position.set(0, 0.84, 0.18);
    robot.add(chest);

    // glowing "720" chest label
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 192;
    const lctx = labelCanvas.getContext('2d');
    lctx.font = '700 120px "Heebo", "Rubik", system-ui, sans-serif';
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.shadowColor = '#7c5cff';
    lctx.shadowBlur = 28;
    lctx.fillStyle = '#9d8bff';
    lctx.fillText('720', 128, 100);
    lctx.shadowBlur = 0;
    lctx.fillStyle = '#e8e3ff';
    lctx.fillText('720', 128, 100);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelTex.anisotropy = 4;
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, toneMapped: false });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), labelMat);
    label.position.set(0, 0.84, 0.198);
    robot.add(label);

    // ===== Shoulders =====
    const shoulderGeo = new THREE.SphereGeometry(0.13, 24, 24);
    const shoulderL = new THREE.Mesh(shoulderGeo, whiteMat);
    shoulderL.scale.set(1, 0.8, 1); shoulderL.position.set(-0.27, 1.0, 0);
    robot.add(shoulderL);
    const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.27; robot.add(shoulderR);
    const collar = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.08, 0.34, 4, 0.03), purpleMat);
    collar.position.y = 1.04;
    robot.add(collar);

    // ===== Head =====
    const head = new THREE.Group();
    head.position.y = 1.28;
    robot.add(head);
    const headMesh = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.42, 0.42, 6, 0.15), whiteMat);
    head.add(headMesh);

    const face = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.28, 0.06, 6, 0.1), faceMat);
    face.position.set(0, 0.01, 0.2);
    head.add(face);

    const eyeGeo = new RoundedBoxGeometry(0.075, 0.09, 0.03, 3, 0.03);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 0.03, 0.225);
    head.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.1; head.add(eyeR);
    const hlGeo = new THREE.SphereGeometry(0.014, 14, 14);
    const hlL = new THREE.Mesh(hlGeo, highlightMat); hlL.position.set(-0.118, 0.055, 0.243); head.add(hlL);
    const hlR = hlL.clone(); hlR.position.x = 0.082; head.add(hlR);

    const smile = new THREE.Mesh(
        new THREE.TorusGeometry(0.072, 0.007, 10, 40, Math.PI * 0.78),
        smileMat
    );
    smile.rotation.z = Math.PI * 1.11;
    smile.position.set(0, -0.025, 0.223);
    head.add(smile);

    const earGeo = new THREE.SphereGeometry(0.07, 20, 20);
    const earL = new THREE.Mesh(earGeo, purpleMat);
    earL.scale.x = 0.5; earL.position.set(-0.24, 0.0, 0);
    head.add(earL);
    const earCapMat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, emissive: 0x4cc9f0, emissiveIntensity: 0.5, roughness: 0.3 });
    const earCapL = new THREE.Mesh(new THREE.CircleGeometry(0.03, 18), earCapMat);
    earCapL.rotation.y = -Math.PI / 2; earCapL.position.set(-0.253, 0, 0); head.add(earCapL);
    const earR = earL.clone(); earR.position.x = 0.24; head.add(earR);
    const earCapR = earCapL.clone(); earCapR.rotation.y = Math.PI / 2; earCapR.position.x = 0.253; head.add(earCapR);

    const antenna = new THREE.Group();
    antenna.position.y = 0.23;
    head.add(antenna);
    const antRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 12), purpleMat);
    antRod.position.y = 0.07;
    antenna.add(antRod);
    const tipMat = new THREE.MeshStandardMaterial({
        color: 0x7c5cff, emissive: 0x7c5cff, emissiveIntensity: 2.2, toneMapped: false
    });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.042, 18, 18), tipMat);
    tip.position.y = 0.16;
    antenna.add(tip);
    const tipLight = new THREE.PointLight(0x7c5cff, 0.5, 1.6);
    tipLight.position.y = 0.16;
    antenna.add(tipLight);

    // ===== Arms =====
    const armHeight = 0.34;
    const makeArm = () => {
        const grp = new THREE.Group();
        const upper = new THREE.Mesh(new RoundedBoxGeometry(0.1, armHeight, 0.12, 4, 0.05), whiteMat);
        upper.geometry.translate(0, -armHeight / 2, 0);
        grp.add(upper);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.088, 20, 20), purpleMat);
        hand.scale.z = 0.85;
        hand.position.y = -armHeight - 0.03;
        grp.add(hand);
        return grp;
    };
    const armL = makeArm(); armL.position.set(-0.27, 1.0, 0.02); robot.add(armL);
    const armR = makeArm(); armR.position.set(0.27, 1.0, 0.02); robot.add(armR);

    // ===== Idle + head follows the cursor =====
    let lookX = 0, lookY = 0;
    g.userData.update = (t) => {
        robot.position.y = Math.sin(t * 1.4) * 0.018;
        robot.rotation.x = 0.03;

        const targetY = pointer.x * 0.6 + Math.sin(t * 0.45) * 0.04;
        const targetX = pointer.y * 0.34 + Math.sin(t * 1.0) * 0.02;
        lookX += (targetY - lookX) * 0.08;
        lookY += (targetX - lookY) * 0.08;
        head.rotation.y = lookX;
        head.rotation.x = lookY;
        head.rotation.z = Math.sin(t * 0.7) * 0.02;
        robot.rotation.y = lookX * 0.32;

        armL.rotation.z = -0.24 + Math.sin(t * 1.2) * 0.04;
        armL.rotation.x = 0.18 + Math.sin(t * 1.2) * 0.04;
        armR.rotation.z = 0.24 + Math.sin(t * 1.1) * 0.04;
        armR.rotation.x = 0.18 + Math.sin(t * 1.5) * 0.04;

        antenna.rotation.z = Math.sin(t * 1.3) * 0.07;
        tipMat.emissiveIntensity = 1.7 + Math.sin(t * 2.4) * 0.5;
        tipLight.intensity = 0.4 + Math.sin(t * 2.4) * 0.2;
        earCapMat.emissiveIntensity = 0.4 + Math.sin(t * 2.4) * 0.2;

        const blinkPhase = (t * 0.5) % 4.2;
        const blink = blinkPhase > 4.0 ? 0.12 : 1.0;
        eyeL.scale.y = blink;
        eyeR.scale.y = blink;
    };

    g.position.y = -0.1;
    g.scale.setScalar(0.78);
    return g;
}

function mount(container, opts = {}) {
    const view = opts.view || 'full';
    const isActive = opts.isActive || (() => container.offsetParent !== null);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(view === 'head' ? 26 : 30, 1, 0.1, 100);
    if (view === 'head') {
        camera.position.set(0, 0.95, 2.05);
    } else {
        camera.position.set(0, 0.92, 3.7);
    }

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9d8fce, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.5);
    keyLight.position.set(4, 9, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa18fff, 0.5);
    fillLight.position.set(-5, 4, -3);
    scene.add(fillLight);

    const robot = makeRobot();
    scene.add(robot);

    const lookTarget = new THREE.Vector3(0, view === 'head' ? 0.9 : 0.78, 0);
    camera.lookAt(lookTarget);

    function resize() {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    function loop() {
        requestAnimationFrame(loop);
        if (!isActive()) return;
        const t = clock.getElapsedTime();
        robot.userData.update(t);
        camera.lookAt(lookTarget);
        renderer.render(scene, camera);
    }
    loop();
    return { renderer, scene, camera };
}

window.YubiRobot = { mount };
