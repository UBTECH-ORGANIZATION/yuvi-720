/* =============================================================
 * YuviLab 720 · 3D Yubi Robot Viewer
 * Procedural Three.js model reused from the YuviLab Academy
 * (matches the "YUBI Robot" asset from the 3D Asset Lab).
 * ============================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const COL = {
    robotBody: 0xfafaff,
    robotShadow: 0xc8c4d4,
    visor: 0x1e1b3a,
    blush: 0xfb7185,
    antennaTip: 0x60a5fa,
};

function makeRobot() {
    const g = new THREE.Group();
    const robot = new THREE.Group();
    robot.position.y = 0.18;
    g.add(robot);

    const whiteMat = new THREE.MeshStandardMaterial({ color: COL.robotBody, roughness: 0.35, metalness: 0.1 });
    const grayMat = new THREE.MeshStandardMaterial({ color: COL.robotShadow, roughness: 0.5, metalness: 0.2 });

    // Body
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.35, 0.32, 3, 0.1), whiteMat);
    body.position.y = 0.4;
    robot.add(body);
    // Belt
    const belt = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.05, 0.34, 2, 0.02), grayMat);
    belt.position.y = 0.27;
    robot.add(belt);

    // Head (BIG chibi)
    const head = new THREE.Group();
    head.position.y = 0.85;
    robot.add(head);
    const headMesh = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.62, 0.62, 4, 0.18), whiteMat);
    head.add(headMesh);

    // Visor
    const visor = new THREE.Mesh(
        new RoundedBoxGeometry(0.66, 0.32, 0.04, 3, 0.12),
        new THREE.MeshStandardMaterial({ color: COL.visor, roughness: 0.2, metalness: 0.4 })
    );
    visor.position.set(0, 0.02, 0.31);
    head.add(visor);

    // Eyes — bright cyan with subtle emissive glow
    const eyeMat = new THREE.MeshStandardMaterial({
        color: 0x00ffee, emissive: 0x00ddcc, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.1
    });
    const eyeGeo = new THREE.SphereGeometry(0.08, 24, 24);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.16, 0.05, 0.33);
    eyeL.scale.set(1, 1, 0.4);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.16;
    head.add(eyeR);

    // Highlights
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), hlMat);
    hlL.position.set(-0.14, 0.08, 0.355);
    head.add(hlL);
    const hlR = hlL.clone();
    hlR.position.x = 0.18;
    head.add(hlR);
    // Cheeks
    const blushMat = new THREE.MeshStandardMaterial({
        color: COL.blush, emissive: COL.blush, emissiveIntensity: 0.6, transparent: true, opacity: 0.7
    });
    const blushL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), blushMat);
    blushL.position.set(-0.32, -0.1, 0.18);
    blushL.scale.set(1, 0.5, 0.3);
    head.add(blushL);
    const blushR = blushL.clone();
    blushR.position.x = 0.32;
    head.add(blushR);

    // Mouth — cyan smile (quadratic bezier curve tube)
    const smileMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const smileCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-0.10, -0.04, 0.34),
        new THREE.Vector3(0.0, -0.10, 0.35),
        new THREE.Vector3(0.10, -0.04, 0.34)
    );
    const smileGeo = new THREE.TubeGeometry(smileCurve, 12, 0.012, 6, false);
    const smile = new THREE.Mesh(smileGeo, smileMat);
    head.add(smile);

    // Antenna
    const antenna = new THREE.Group();
    antenna.position.y = 0.32;
    head.add(antenna);
    const antBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 12), grayMat);
    antBase.position.y = 0.04;
    antenna.add(antBase);
    const antRod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.18, 12), grayMat);
    antRod.position.y = 0.18;
    antenna.add(antRod);
    const tipMat = new THREE.MeshStandardMaterial({
        color: COL.antennaTip, emissive: COL.antennaTip, emissiveIntensity: 2.5, toneMapped: false
    });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), tipMat);
    tip.position.y = 0.32;
    antenna.add(tip);
    const tipLight = new THREE.PointLight(COL.antennaTip, 0.6, 1.5);
    tipLight.position.y = 0.32;
    antenna.add(tipLight);

    // Arms — group-based with shoulder pivot + robot hands
    const armHeight = 0.32;
    const handMat = new THREE.MeshStandardMaterial({ color: 0xd0cbe0, roughness: 0.4, metalness: 0.2 });

    const armLMesh = new THREE.Mesh(new RoundedBoxGeometry(0.12, armHeight, 0.14, 2, 0.05), whiteMat);
    armLMesh.geometry.translate(0, -armHeight / 2, 0);
    const armL = new THREE.Group();
    armL.position.set(-0.32, 0.4, 0);
    armL.add(armLMesh);
    const palmL = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.05, 0.14, 2, 0.02), handMat);
    palmL.position.y = -armHeight - 0.025;
    armL.add(palmL);
    for (let fi = -1; fi <= 1; fi++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.06, 6), handMat);
        finger.position.set(fi * 0.04, -armHeight - 0.07, 0);
        armL.add(finger);
    }
    robot.add(armL);

    const armRMesh = new THREE.Mesh(new RoundedBoxGeometry(0.12, armHeight, 0.14, 2, 0.05), whiteMat);
    armRMesh.geometry.translate(0, -armHeight / 2, 0);
    const armR = new THREE.Group();
    armR.position.set(0.32, 0.4, 0);
    armR.add(armRMesh);
    const palmR = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.05, 0.14, 2, 0.02), handMat);
    palmR.position.y = -armHeight - 0.025;
    armR.add(palmR);
    for (let fi = -1; fi <= 1; fi++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.06, 6), handMat);
        finger.position.set(fi * 0.04, -armHeight - 0.07, 0);
        armR.add(finger);
    }
    robot.add(armR);

    // Feet
    const footMat = new THREE.MeshStandardMaterial({ color: 0xb8b3c8, roughness: 0.5, metalness: 0.2 });
    const footL = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.22, 2, 0.04), footMat);
    footL.position.set(-0.12, 0.05, 0.02);
    robot.add(footL);
    const footR = footL.clone();
    footR.position.x = 0.12;
    robot.add(footR);

    // Idle "waving" animation (matches the Academy idle pose)
    g.userData.update = (t) => {
        robot.position.y = 0.18 + Math.sin(t * 2) * 0.05;
        robot.rotation.y = Math.sin(t * 0.8) * 0.08;
        head.rotation.y = Math.sin(t * 0.6) * 0.15;
        // Left arm raised in a friendly wave
        armL.rotation.x = -2.5;
        armL.rotation.z = -0.5 + Math.sin(t * 3) * -0.15;
        armR.rotation.x = -Math.sin(t * 2) * 0.05;
        armR.rotation.z = 0;

        antenna.rotation.z = Math.sin(t * 1.5) * 0.12;
        tipMat.emissiveIntensity = 2.0 + Math.sin(t * 3) * 0.8;
        tipLight.intensity = 0.5 + Math.sin(t * 3) * 0.3;

        const blinkPhase = (t * 0.5) % 4;
        const blink = blinkPhase > 3.8 ? 0.05 : 1.0;
        eyeL.scale.y = blink;
        eyeR.scale.y = blink;
        hlL.visible = blink > 0.5;
        hlR.visible = blink > 0.5;
    };

    return g;
}

function initRobot(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 1.05, 4.0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.autoRotate = false;
    controls.target.set(0, 0.82, 0);

    // Lights — bright, soft, matching the Academy look
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9d8fce, 1.15));
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.5);
    keyLight.position.set(4, 9, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa18fff, 0.5);
    fillLight.position.set(-5, 4, -3);
    scene.add(fillLight);

    const robot = makeRobot();
    scene.add(robot);

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
        // Pause work while the intro screen is hidden
        if (!container.offsetParent) return;
        const t = clock.getElapsedTime();
        robot.userData.update(t);
        controls.update();
        renderer.render(scene, camera);
    }
    loop();
}

const mount = document.getElementById('robot3d');
if (mount) {
    try {
        initRobot(mount);
    } catch (err) {
        console.error('3D robot failed to initialize:', err);
    }
}
