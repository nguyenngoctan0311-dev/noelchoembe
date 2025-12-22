import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture,
  Text
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- CẤU HÌNH ĐƯỜNG DẪN ---
const BASE_URL = import.meta.env.BASE_URL;

// --- MỚI: ĐƯỜNG DẪN NHẠC (Đảm bảo file mp3 nằm trong thư mục public) ---
const MUSIC_PATH = `${BASE_URL}bg-music.mp3`;

const TOTAL_NUMBERED_PHOTOS = 15;

const bodyPhotoPaths = [
  `${BASE_URL}photos/top.jpg`,
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `${BASE_URL}photos/${i + 1}.jpg`)
];

// --- CẤU HÌNH VISUAL ---
const CONFIG = {
  colors: {
    emerald: '#004225', gold: '#FFD700', silver: '#ECEFF1', red: '#D32F2F',
    green: '#2E7D32', white: '#FFFFFF', warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
  },
  counts: { foliage: 15000, ornaments: 300, elements: 200, lights: 400 },
  tree: { height: 22, radius: 9 },
  photos: { body: bodyPhotoPaths }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments ---
const PhotoOrnaments = ({ state, handRef }: { state: 'CHAOS' | 'FORMED', handRef: any }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const { camera, raycaster } = useThree();

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const hoveredIndexRef = useRef<number | null>(null);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];
      return {
        chaosPos, targetPos, baseScale, currentScale: baseScale, weight,
        textureIndex: i % textures.length, borderColor, currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI),
        rotationSpeed: { x: (Math.random()-0.5), y: (Math.random()-0.5), z: (Math.random()-0.5) },
        wobbleOffset: Math.random() * 10, wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    
    if (handRef.current.active) {
        raycaster.setFromCamera({ x: handRef.current.x, y: handRef.current.y }, camera);
        const intersects = raycaster.intersectObjects(groupRef.current.children, true);
        if (intersects.length > 0) {
            let object = intersects[0].object;
            while(object.parent && object.parent !== groupRef.current) { object = object.parent; }
            hoveredIndexRef.current = groupRef.current.children.indexOf(object);
        } else { hoveredIndexRef.current = null; }
    } else { hoveredIndexRef.current = null; }

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);
      
      let targetScale = objData.baseScale;
      if (hoveredIndexRef.current === i) {
          targetScale = objData.baseScale * 1.2; 
          if (handRef.current.distance > 0.05) {
              const zoomFactor = 1 + (handRef.current.distance * 8.0);
              targetScale = Math.min(objData.baseScale * 5.0, objData.baseScale * zoomFactor);
          }
          group.lookAt(camera.position);
      } else {
          if (isFormed) {
             group.lookAt(new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2));
             group.rotation.x += Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
             group.rotation.z += Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
          } else {
             group.rotation.x += delta * objData.rotationSpeed.x;
             group.rotation.y += delta * objData.rotationSpeed.y;
             group.rotation.z += delta * objData.rotationSpeed.z;
          }
      }
      const newScale = MathUtils.lerp(group.scale.x, targetScale, delta * 5);
      group.scale.set(newScale, newScale, newScale);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.baseScale, obj.baseScale, obj.baseScale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} 
                emissiveIntensity={hoveredIndexRef.current === i ? 1.5 : 1.0} side={THREE.FrontSide} />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={hoveredIndexRef.current === i ? '#FFFF00' : obj.borderColor} 
                emissive={hoveredIndexRef.current === i ? '#FFFF00' : '#000000'} emissiveIntensity={hoveredIndexRef.current === i ? 0.5 : 0}
                roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.5} metalness={0} emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0} side={THREE.FrontSide} />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius; const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed: { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 } };
    });
  }, []);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh; const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);
  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED'; const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh; mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath(); return shape;
  }, []);
  const starGeometry = useMemo(() => new THREE.ExtrudeGeometry(starShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 }), [starShape]);
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, emissive: CONFIG.colors.gold, emissiveIntensity: 1.5, roughness: 0.1, metalness: 1.0 }), []);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });
  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- MỚI: COMPONENT TRÁI TIM 3D KHỔNG LỒ ---
const BigHeart = ({ show }: { show: boolean }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    
    // Tạo hình dáng trái tim 2D
    const heartShape = useMemo(() => {
        const shape = new THREE.Shape();
        const x = 0, y = 0;
        shape.moveTo(x + 2.5, y + 2.5);
        shape.bezierCurveTo(x + 2.5, y + 2.5, x + 2.0, y, x, y);
        shape.bezierCurveTo(x - 3.0, y, x - 3.0, y + 3.5, x - 3.0, y + 3.5);
        shape.bezierCurveTo(x - 3.0, y + 5.5, x - 1.0, y + 7.7, x + 2.5, y + 9.5);
        shape.bezierCurveTo(x + 6.0, y + 7.7, x + 8.0, y + 5.5, x + 8.0, y + 3.5);
        shape.bezierCurveTo(x + 8.0, y + 3.5, x + 8.0, y, x + 5.0, y);
        shape.bezierCurveTo(x + 3.5, y, x + 2.5, y + 2.5, x + 2.5, y + 2.5);
        return shape;
    }, []);

    // Kéo vân 3D (Extrude)
    const heartGeometry = useMemo(() => new THREE.ExtrudeGeometry(heartShape, {
        depth: 2, bevelEnabled: true, bevelSegments: 5, steps: 2, bevelSize: 1, bevelThickness: 1
    }), [heartShape]);

    // Material đỏ phát sáng
    const heartMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: "#D32F2F", emissive: "#FF0000", emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.5
    }), []);

    // Hiệu ứng đập thình thịch
    useFrame((state) => {
        if (meshRef.current && show) {
            const time = state.clock.elapsedTime;
            const beat = 1 + Math.sin(time * 8) * 0.05; // Nhịp đập nhanh
            // Lerp scale để hiện/ẩn mượt mà
            const targetScale = show ? beat * 0.8 : 0;
            meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
        }
    });

    return (
        // Đặt vị trí ở giữa cây, xoay ngược lại cho đúng chiều
        <group rotation={[Math.PI, 0, 0]} position={[0, 5, 0]}> 
            {/* Căn giữa tâm xoay của trái tim */}
            <mesh ref={meshRef} geometry={heartGeometry} material={heartMaterial} position={[-2.5, -5, 0]}>
            </mesh>
            {show && <pointLight position={[0, -2, 2]} intensity={50} color="#FF0000" distance={20} />}
        </group>
    );
}

// --- Component: 3D Cursor ---
const Cursor3D = ({ handRef }: { handRef: any }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const { camera } = useThree();
    useFrame(() => {
        if (meshRef.current) {
            if (handRef.current.active) {
                const vec = new THREE.Vector3(handRef.current.x, handRef.current.y, 0.5); 
                vec.unproject(camera);
                vec.sub(camera.position).normalize();
                const distance = 40;
                const pos = camera.position.clone().add(vec.multiplyScalar(distance));
                meshRef.current.position.copy(pos);
                meshRef.current.visible = true;
            } else { meshRef.current.visible = false; }
        }
    });
    return ( <mesh ref={meshRef}> <sphereGeometry args={[0.2, 16, 16]} /> <meshBasicMaterial color="red" transparent opacity={0.8} /> </mesh> );
}

// --- Main Scene Experience ---
// MỚI: Thêm prop showHeart
const Experience = ({ sceneState, rotationSpeed, handRef, showHeart }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, handRef: any, showHeart: boolean }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      const isInteracting = handRef.current.active && handRef.current.distance > 0.1;
      if (!isInteracting) { controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed); }
      controlsRef.current.update();
    }
  });
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />
      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />
      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />
      <Cursor3D handRef={handRef} />
      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} handRef={handRef} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
           {/* MỚI: Thêm trái tim khổng lồ vào scene */}
           <BigHeart show={showHeart} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>
      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// MỚI: Thêm prop onHeartStatus để báo cáo trạng thái tim
const GestureController = ({ onGesture, onMove, onStatus, debugMode, handRef, onHeartStatus }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2 // MỚI: Quan trọng! Cần nhận diện 2 tay để ghép tim
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: 1 HAND=ZOOM | 2 HANDS=HEART");
            predictWebcam();
          }
        } else { onStatus("ERROR: CAMERA PERMISSION DENIED"); }
      } catch (err: any) { onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`); }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            // --- XỬ LÝ CỬ CHỈ (NÂNG CẤP) ---
            let isHeartFound = false;

            // MỚI: Logic nhận diện 2 tay ghép tim
            if (results.landmarks.length === 2) {
                const hand1 = results.landmarks[0];
                const hand2 = results.landmarks[1];
                
                // Đầu ngón cái (4) và đầu ngón trỏ (8) của 2 tay
                const thumb1 = hand1[4]; const index1 = hand1[8];
                const thumb2 = hand2[4]; const index2 = hand2[8];

                // Tính khoảng cách giữa 2 ngón trỏ và 2 ngón cái
                const indexDist = Math.hypot(index1.x - index2.x, index1.y - index2.y);
                const thumbDist = Math.hypot(thumb1.x - thumb2.x, thumb1.y - thumb2.y);

                // HEURISTIC: Nếu 2 đầu ngón trỏ gần nhau VÀ 2 đầu ngón cái gần nhau
                // Ngưỡng 0.08 là tương đối, cần thử nghiệm thực tế
                if (indexDist < 0.08 && thumbDist < 0.08) {
                    isHeartFound = true;
                    // Khi ghép tim thì tắt chế độ con trỏ 1 tay đi
                    handRef.current.active = false;
                }
            }

            // Báo cáo trạng thái tim ra ngoài
            onHeartStatus(isHeartFound);

            // Logic 1 tay cũ (Chỉ chạy khi không phải là tim)
            if (!isHeartFound && results.landmarks.length > 0) {
                // Luôn lấy tay đầu tiên làm con trỏ
                const lm = results.landmarks[0];
                const thumb = lm[4]; const index = lm[8];
                const cursorX = (0.5 - index.x) * 2; 
                const cursorY = (0.5 - index.y) * 2;
                const distance = Math.sqrt(Math.pow(thumb.x - index.x, 2) + Math.pow(thumb.y - index.y, 2));

                handRef.current = { active: true, x: cursorX, y: cursorY, distance: distance };

                const speed = cursorX * 0.05; 
                onMove(Math.abs(speed) > 0.005 ? speed : 0);

                if (results.gestures.length > 0 && results.gestures[0].length > 0) {
                     const name = results.gestures[0][0].categoryName; 
                     const score = results.gestures[0][0].score;
                     if (score > 0.5) {
                        if (name === "Open_Palm") onGesture("CHAOS");
                        if (name === "Closed_Fist") onGesture("FORMED");
                     }
                }
            } else if (!isHeartFound) { 
                handRef.current.active = false;
                onMove(0); 
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode, onHeartStatus]); // Thêm onHeartStatus vào dependency

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- MỚI: COMPONENT NÚT NHẠC ---
const MusicPlayer = () => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                // Trình duyệt yêu cầu tương tác người dùng mới được phát nhạc
                audioRef.current.play().catch(e => console.error("Music playback failed:", e));
            }
            setIsPlaying(!isPlaying);
        }
    };

    return (
        <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 20 }}>
            <audio ref={audioRef} src={MUSIC_PATH} loop volume={0.5} />
            <button onClick={togglePlay} style={{
                background: isPlaying ? 'rgba(255, 215, 0, 0.8)' : 'rgba(0,0,0,0.5)',
                border: '1px solid #FFD700', color: isPlaying ? '#000' : '#FFD700',
                padding: '10px', borderRadius: '50%', cursor: 'pointer',
                width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px'
            }}>
                {isPlaying ? '🔊' : '🔇'}
            </button>
        </div>
    );
};


// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  // MỚI: State quản lý hiển thị tim
  const [showHeart, setShowHeart] = useState(false);

  const handRef = useRef({ active: false, x: 0, y: 0, distance: 0 });

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      {/* MỚI: Nút nhạc */}
      <MusicPlayer />

      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
            {/* Truyền state showHeart xuống Experience */}
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} handRef={handRef} showHeart={showHeart} />
        </Canvas>
      </div>
      {/* Truyền hàm setShowHeart xuống GestureController */}
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} handRef={handRef} onHeartStatus={setShowHeart} />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
            <p style={{ color: '#aaa', fontSize: '12px', lineHeight: '1.5' }}>
                👉 Point 1 finger to select & zoom photo.<br/>
                🫶 <b>Make a HEART with 2 hands!</b>
            </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}