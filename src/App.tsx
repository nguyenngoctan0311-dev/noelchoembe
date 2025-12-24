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

// --- KIỂM TRA THIẾT BỊ (MOBILE/PC) ---
const isMobile = window.innerWidth < 768;

// --- CẤU HÌNH ĐƯỜNG DẪN ---
const BASE_URL = import.meta.env.BASE_URL;
const MUSIC_PATH = `${BASE_URL}bg-music.mp3`;

const TOTAL_NUMBERED_PHOTOS = 15;
const bodyPhotoPaths = [
  `${BASE_URL}photos/top.jpg`,
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `${BASE_URL}photos/${i + 1}.jpg`)
];

// --- CẤU HÌNH VISUAL (TỐI ƯU CHO MOBILE) ---
const CONFIG = {
  colors: {
    emerald: '#004225', gold: '#FFD700', silver: '#ECEFF1', red: '#D32F2F',
    green: '#2E7D32', white: '#FFFFFF', warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    neutralGray: '#666666',
  },
  counts: { 
    foliage: isMobile ? 6000 : 15000, 
    ornaments: 300, 
    elements: isMobile ? 100 : 200, 
    lights: isMobile ? 200 : 400,
    snow: isMobile ? 600 : 2000 
  },
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
  const hitboxGeometry = useMemo(() => new THREE.BoxGeometry(1.5, 1.8, 0.2), []);
  const hoveredIndexRef = useRef<number | null>(null);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*45, (Math.random()-0.5)*45, (Math.random()-0.5)*45);
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
    
    // Chỉ chọn ảnh khi CHAOS
    if (handRef.current.active && state === 'CHAOS') {
        raycaster.setFromCamera({ x: handRef.current.x, y: handRef.current.y }, camera);
        const intersects = raycaster.intersectObjects(groupRef.current.children, true);
        if (intersects.length > 0) {
            let object = intersects[0].object;
            while(object.parent && object.parent !== groupRef.current) { object = object.parent; }
            hoveredIndexRef.current = groupRef.current.children.indexOf(object);
        } else { hoveredIndexRef.current = null; }
    } else { hoveredIndexRef.current = null; }

    let handOffsetX = 0;
    let handOffsetY = 0;
    if (!isFormed && handRef.current.active) {
        handOffsetX = handRef.current.x * 30; 
        handOffsetY = handRef.current.y * 30;
    }

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      let target;
      if (isFormed) {
          target = objData.targetPos;
      } else {
          target = objData.chaosPos.clone();
          target.x += handOffsetX * (objData.weight * 0.8);
          target.y += handOffsetY * (objData.weight * 0.8);
      }

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 2.0));
      group.position.copy(objData.currentPos);
      
      let targetScale = objData.baseScale;
      if (hoveredIndexRef.current === i) {
          const hoverZoomBase = objData.baseScale * 2.5;
          targetScale = hoverZoomBase;
          if (handRef.current.distance > 0.05) {
              const pinchFactor = 1 + (handRef.current.distance * 5.0); 
              targetScale = Math.min(objData.baseScale * 6.0, hoverZoomBase * pinchFactor);
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
      const newScale = MathUtils.lerp(group.scale.x, targetScale, delta * 6);
      group.scale.set(newScale, newScale, newScale);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.baseScale, obj.baseScale, obj.baseScale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          <mesh geometry={hitboxGeometry} visible={false}>
             <meshBasicMaterial transparent opacity={0} />
          </mesh>
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial 
                map={textures[obj.textureIndex]} 
                roughness={0.5} 
                metalness={0}
                emissive={CONFIG.colors.neutralGray} 
                emissiveMap={textures[obj.textureIndex]} 
                emissiveIntensity={hoveredIndexRef.current === i ? 0.4 : 0.1} 
                side={THREE.FrontSide} 
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial 
                color={hoveredIndexRef.current === i ? '#FFFF00' : obj.borderColor} 
                emissive={hoveredIndexRef.current === i ? '#FFFF00' : '#000000'} 
                emissiveIntensity={hoveredIndexRef.current === i ? 0.3 : 0}
                roughness={0.9} 
                metalness={0} 
                side={THREE.FrontSide} 
              />
            </mesh>
          </group>
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.5} metalness={0} emissive={CONFIG.colors.neutralGray} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={0.1} side={THREE.FrontSide} />
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
  
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.6, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius; const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const type = Math.floor(Math.random() * 3);
      let color; 
      let scale = 1;

      if (type === 0) { 
          color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; 
          scale = 0.25 + Math.random() * 0.2; 
      }
      else if (type === 1) { 
          color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; 
          scale = 0.2 + Math.random() * 0.2; 
      }
      else { 
          color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; 
          scale = 0.2 + Math.random() * 0.2; 
      }

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
          <meshStandardMaterial 
            color={obj.color} 
            roughness={0.2} 
            metalness={0.8} 
            emissive={obj.color} 
            emissiveIntensity={4.0} 
            toneMapped={false} 
          />
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
      const targetScale = state === 'FORMED' ? 1.3 : 0;
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

// --- COMPONENT TRÁI TIM PIXEL ---
const BigHeart = ({ show }: { show: boolean }) => {
    const pointsRef = useRef<THREE.Points>(null);
    const positions = useMemo(() => {
        const particleCount = 3000; const pointsData = [];
        for (let i = 0; i < particleCount; i++) {
            const t = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()); const scale = 0.25;
            const x = r * (16 * Math.pow(Math.sin(t), 3)) * scale;
            const y = r * (13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t)) * scale;
            const z = (Math.random() - 0.5) * 2; 
            pointsData.push(x, y, z);
        }
        return new Float32Array(pointsData);
    }, []);
    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geo;
    }, [positions]);
    const material = useMemo(() => new THREE.PointsMaterial({
        color: "#FF0000", size: 3, sizeAttenuation: false, transparent: true, opacity: 1.0,
    }), []);
    useFrame((state) => {
        if (pointsRef.current) { 
            const time = state.clock.elapsedTime;
            const beat = 1 + Math.sin(time * 10) * 0.08; 
            const targetScale = show ? beat * 1.2 : 0; 
            pointsRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
            if (show) pointsRef.current.rotation.y += 0.005;
        }
    });
    return (
        <group rotation={[0, 0, 0]} position={[0, 6, 0]}> 
            <points ref={pointsRef} geometry={geometry} material={material} scale={[0, 0, 0]} />
            <pointLight position={[0, 0, 2]} intensity={show ? 80 : 0} color="#FF0000" distance={25} decay={2} />
        </group>
    );
}

// --- MỚI: PHIÊN BẢN VOXEL PORSCHE SANTA & QUÀ ---

const VOXEL_MATS = {
  brown: new THREE.MeshStandardMaterial({ color: "#5D4037", roughness: 0.8 }), 
  red: new THREE.MeshStandardMaterial({ color: "#B71C1C", roughness: 0.3, metalness: 0.5 }), 
  brightRed: new THREE.MeshStandardMaterial({ color: "#D50000", roughness: 0.8 }), 
  white: new THREE.MeshStandardMaterial({ color: "#ECEFF1", roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ color: "#FFC107", roughness: 0.3, metalness: 0.8 }), 
  flesh: new THREE.MeshStandardMaterial({ color: "#FFCCBC", roughness: 0.6 }),
  black: new THREE.MeshStandardMaterial({ color: "#111111", roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: "#CCCCCC", metalness: 0.9, roughness: 0.1 }),
  tire: new THREE.MeshStandardMaterial({ color: "#222222", roughness: 0.9 }),
  windshield: new THREE.MeshStandardMaterial({ color: "#88CCFF", transparent: true, opacity: 0.6, metalness: 0.9, roughness: 0.1 }),
  // Thêm màu xanh lá cho hộp quà
  green: new THREE.MeshStandardMaterial({ color: "#2E7D32", roughness: 0.8 }), 
};

// Danh sách các cặp màu cho hộp quà
const GIFT_MATS = [
    { box: VOXEL_MATS.red, ribbon: VOXEL_MATS.gold },
    { box: VOXEL_MATS.green, ribbon: VOXEL_MATS.red },
    { box: VOXEL_MATS.white, ribbon: VOXEL_MATS.red },
    { box: VOXEL_MATS.gold, ribbon: VOXEL_MATS.white },
];

// Component Hộp quà Voxel
const VoxelGift = ({ index }: { index: number }) => {
  const mat = GIFT_MATS[index % GIFT_MATS.length];
  return (
    <group>
       {/* Hộp chính */}
       <mesh material={mat.box}> <boxGeometry args={[0.8, 0.8, 0.8]} /> </mesh>
       {/* Ruy băng ngang */}
       <mesh material={mat.ribbon}> <boxGeometry args={[0.82, 0.82, 0.2]} /> </mesh>
       {/* Ruy băng dọc */}
       <mesh material={mat.ribbon}> <boxGeometry args={[0.2, 0.82, 0.82]} /> </mesh>
    </group>
  );
}

const VoxelPorscheSanta = () => {
  const wheelGeo = useMemo(() => new THREE.CylinderGeometry(0.6, 0.6, 0.5, 16), []);
  return (
    <group>
      {/* --- THÂN XE PORSCHE --- */}
      <mesh position={[0, 0.5, 0]} material={VOXEL_MATS.red}> <boxGeometry args={[2.4, 0.7, 5.0]} /> </mesh>
      <mesh position={[0, 0.6, 2.0]} material={VOXEL_MATS.red} rotation={[Math.PI/32, 0, 0]}> <boxGeometry args={[2.3, 0.5, 1.5]} /> </mesh>
      <mesh position={[0, 0.6, -2.0]} material={VOXEL_MATS.red}> <boxGeometry args={[2.3, 0.6, 1.2]} /> </mesh>
      <mesh position={[0, 1.0, -2.4]} material={VOXEL_MATS.red}> <boxGeometry args={[2.2, 0.1, 0.5]} /> </mesh>
      {/* --- BÁNH XE --- */}
      <group rotation={[0, 0, Math.PI / 2]}>
          <mesh position={[0.5, 1.2, 1.6]} geometry={wheelGeo} material={VOXEL_MATS.tire} /> 
          <mesh position={[0.5, -1.2, 1.6]} geometry={wheelGeo} material={VOXEL_MATS.tire} /> 
          <mesh position={[0.5, 1.2, -1.8]} geometry={wheelGeo} material={VOXEL_MATS.tire} /> 
          <mesh position={[0.5, -1.2, -1.8]} geometry={wheelGeo} material={VOXEL_MATS.tire} /> 
          <mesh position={[0.52, 1.2, 1.6]} material={VOXEL_MATS.chrome}> <cylinderGeometry args={[0.3, 0.3, 0.52, 8]} /> </mesh>
          <mesh position={[0.52, -1.2, 1.6]} material={VOXEL_MATS.chrome}> <cylinderGeometry args={[0.3, 0.3, 0.52, 8]} /> </mesh>
          <mesh position={[0.52, 1.2, -1.8]} material={VOXEL_MATS.chrome}> <cylinderGeometry args={[0.3, 0.3, 0.52, 8]} /> </mesh>
          <mesh position={[0.52, -1.2, -1.8]} material={VOXEL_MATS.chrome}> <cylinderGeometry args={[0.3, 0.3, 0.52, 8]} /> </mesh>
      </group>
      {/* --- NỘI THẤT --- */}
      <mesh position={[0, 0.8, -0.2]} material={VOXEL_MATS.black}> <boxGeometry args={[2.0, 0.4, 2.5]} /> </mesh>
      <mesh position={[0, 0.8, -0.8]} material={VOXEL_MATS.brown}> <boxGeometry args={[1.5, 0.6, 0.8]} /> </mesh>
      <mesh position={[0, 1.4, 0.7]} material={VOXEL_MATS.chrome} rotation={[-Math.PI/6, 0, 0]}> <boxGeometry args={[2.1, 0.8, 0.1]} /> </mesh>
      <mesh position={[0, 1.4, 0.7]} material={VOXEL_MATS.windshield} rotation={[-Math.PI/6, 0, 0]}> <boxGeometry args={[1.9, 0.7, 0.12]} /> </mesh>
      {/* --- ÔNG GIÀ NOEL --- */}
      <group position={[0, 1.1, -0.8]}>
         <mesh position={[0, 0.3, 0]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.9, 0.8, 0.7]} /> </mesh>
         <mesh position={[0, 1.0, 0]} material={VOXEL_MATS.flesh}> <boxGeometry args={[0.6, 0.6, 0.6]} /> </mesh>
         <mesh position={[0, 0.9, 0.35]} material={VOXEL_MATS.white}> <boxGeometry args={[0.7, 0.5, 0.2]} /> </mesh>
         <mesh position={[0, 1.4, 0]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.7, 0.4, 0.7]} /> </mesh>
         <mesh position={[0, 1.6, 0.3]} material={VOXEL_MATS.white}> <boxGeometry args={[0.2, 0.2, 0.2]} /> </mesh>
         <mesh position={[0.3, 0.3, 0.6]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.2, 0.2, 0.5]} /> </mesh>
         <mesh position={[-0.3, 0.3, 0.6]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.2, 0.2, 0.5]} /> </mesh>
         <mesh position={[0, 0.3, 1.0]} material={VOXEL_MATS.black} rotation={[Math.PI/3, 0, 0]}> <torusGeometry args={[0.3, 0.05, 8, 16]} /> </mesh>
      </group>
       <mesh position={[0.8, 0.6, 2.7]} material={VOXEL_MATS.gold}> <boxGeometry args={[0.4, 0.2, 0.1]} /> </mesh>
       <mesh position={[-0.8, 0.6, 2.7]} material={VOXEL_MATS.gold}> <boxGeometry args={[0.4, 0.2, 0.1]} /> </mesh>
       <mesh position={[0.8, 0.7, -2.6]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.4, 0.15, 0.1]} /> </mesh>
       <mesh position={[-0.8, 0.7, -2.6]} material={VOXEL_MATS.brightRed}> <boxGeometry args={[0.4, 0.15, 0.1]} /> </mesh>
    </group>
  );
};

// Component Bay (ĐÃ FIX VÀ THÊM QUÀ BAY THEO SAU)
const FlyingSantaVoxel = () => {
  const groupRef = useRef<THREE.Group>(null);
  const giftRefs = useRef<(THREE.Group | null)[]>([]);

  const giftsData = useMemo(() => {
       return new Array(6).fill(0).map((_, i) => ({
           offset: [
               (Math.random() - 0.5) * 1.5, 
               (Math.random() - 0.5) * 1.0 + 0.8, 
               -3.5 - (i * 1.3) - Math.random() * 0.5 
           ] as [number, number, number],
           rotSpeed: [(Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2],
           scale: 0.6 + Math.random() * 0.3 
       }));
  }, []);
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime * 0.1;

    const widthX = 30; 
    const depthZ = 8; 
    const x = Math.cos(time) * widthX;
    const y = 18 + Math.sin(time * 4) * 1.5; 
    const z = Math.sin(time) * depthZ + 5; 

    groupRef.current.position.set(x, y, z);

    const dx = -widthX * Math.sin(time);
    const dz = depthZ * Math.cos(time);
    const angle = Math.atan2(dx, dz);
    groupRef.current.rotation.set(0, angle, 0); 

    giftRefs.current.forEach((gift, i) => {
        if(gift) {
            gift.rotation.x += giftsData[i].rotSpeed[0] * delta;
            gift.rotation.y += giftsData[i].rotSpeed[1] * delta;
            gift.rotation.z += giftsData[i].rotSpeed[2] * delta;
        }
    });
  });

  return (
    <group ref={groupRef}>
      {/* Tăng kích thước lên 1.2 */}
      <group scale={[1.2, 1.2, 1.2]}> 
          <VoxelPorscheSanta />
          
          {giftsData.map((data, i) => (
            <group key={i} position={data.offset} scale={data.scale} ref={el => giftRefs.current[i] = el}>
                 <VoxelGift index={i} />
            </group>
          ))}

          <group position={[0, 0.2, -4.5]}>
             <Sparkles count={150} scale={10} size={8} speed={1.5} opacity={0.8} color="#FFD700" mixColor="#FF0000" />
          </group>
      </group>
    </group>
  );
};

// --- MỚI: HÀM TẠO TEXTURE HÌNH TRÒN MỀM CHO TUYẾT ---
const createSnowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');

  if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)'); // Tâm trắng, rõ
      gradient.addColorStop(1, 'rgba(255,255,255,0)'); // Rìa trong suốt

      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};


// --- MỚI: COMPONENT HIỆU ỨNG TUYẾT RƠI (BÔNG TUYẾT TRÒN) ---
const Snow = () => {
  const count = CONFIG.counts.snow; // Sử dụng số lượng tối ưu
  const area = [100, 100, 100]; 
  const pointsRef = useRef<THREE.Points>(null);
  
  // Tạo texture một lần duy nhất
  const snowTexture = useMemo(() => createSnowTexture(), []);

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * area[0];     
      positions[i * 3 + 1] = (Math.random() - 0.5) * area[1]; 
      positions[i * 3 + 2] = (Math.random() - 0.5) * area[2]; 
      speeds[i] = 0.5 + Math.random() * 1.5; 
    }
    return { positions, speeds };
  }, [count]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const positionsArray = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const bottomY = -area[1] / 2;
    const topY = area[1] / 2;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positionsArray[i3 + 1] -= speeds[i] * delta * 5; 

      if (positionsArray[i3 + 1] < bottomY) {
        positionsArray[i3 + 1] = topY;
        positionsArray[i3] = (Math.random() - 0.5) * area[0];
        positionsArray[i3 + 2] = (Math.random() - 0.5) * area[2];
      }
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
          size={1.2} // Tăng kích thước lên vì dùng texture
          map={snowTexture} // Áp dụng texture hình tròn
          color="#FFFFFF"
          transparent
          opacity={0.8}
          depthWrite={false} 
          blending={THREE.AdditiveBlending} 
       />
    </points>
  );
};


// --- Component: 3D Cursor (ĐÃ SỬA: CHỈ HIỆN KHI CHAOS) ---
const Cursor3D = ({ handRef, sceneState }: { handRef: any, sceneState: 'CHAOS' | 'FORMED' }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const { camera } = useThree();
    useFrame(() => {
        if (meshRef.current) {
            // Chỉ hiện khi tay hoạt động VÀ đang ở trạng thái CHAOS
            if (handRef.current.active && sceneState === 'CHAOS') {
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
const Experience = ({ sceneState, cameraMovement, handRef, showHeart }: { sceneState: 'CHAOS' | 'FORMED', cameraMovement: {x: number, y: number}, handRef: any, showHeart: boolean }) => {
  const controlsRef = useRef<any>(null);
  
  useFrame(() => {
    if (controlsRef.current) {
      // Logic xoay camera (Luôn hoạt động nếu có cameraMovement)
      const isInteracting = handRef.current.active; // Bỏ check distance để nhạy hơn cho việc xoay

      if (isInteracting) {
          // Xoay ngang (Trái/Phải)
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth + cameraMovement.x);

          // Xoay dọc (Trên/Dưới) - Mới thêm
          const currentPolar = controlsRef.current.getPolarAngle();
          // Thêm cameraMovement.y vào góc hiện tại
          const newPolar = currentPolar + cameraMovement.y;
          
          // Giới hạn góc nhìn để không bị lộn ngược (0.5 đến 2.5 radian)
          // 0 = nhìn từ đỉnh xuống, PI = nhìn từ dưới lên
          if (newPolar > 0.5 && newPolar < 2.5) {
              controlsRef.current.setPolarAngle(newPolar);
          }
      } else if (sceneState === 'FORMED') {
          // Tự động xoay nhẹ khi ở dạng cây và không có tương tác tay
          controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + 0.002);
      }

      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls 
        ref={controlsRef} 
        enablePan={false} 
        enableZoom={true} 
        minDistance={30} 
        maxDistance={120} 
        autoRotate={false} // Tắt autoRotate mặc định để dùng logic custom ở trên
        maxPolarAngle={Math.PI / 1.5} 
      />
      <color attach="background" args={['#050505']} />
      {/* THÊM HIỆU ỨNG TUYẾT RƠI Ở ĐÂY */}
      <Snow />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />
      <ambientLight intensity={0.5} color="#404040" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      
      {/* Chỉ render bóng đổ khi không phải mobile */}
      <directionalLight position={[10, 50, 20]} intensity={2.0} color="#ffffff" castShadow={!isMobile} />

      {/* Truyền sceneState vào Cursor3D */}
      <Cursor3D handRef={handRef} sceneState={sceneState} />
      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} handRef={handRef} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
           <BigHeart show={showHeart} />
           {/* ÔNG GIÀ NOEL LÁI PORSCHE VÀ QUÀ BAY NGANG */}
           <FlyingSantaVoxel />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>
      <EffectComposer multisampling={isMobile ? 0 : 8}>
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.1} intensity={2.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
const GestureController = ({ onGesture, onMove, onStatus, debugMode, handRef, onHeartStatus }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Refs cho Double Clench Detection
  const lastGesture = useRef("");
  const lastTime = useRef(0);
  const clickCount = useRef(0);

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
          numHands: 2 
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: OPEN HAND=ROTATE | DOUBLE CLENCH=TOGGLE");
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

            // --- XỬ LÝ CỬ CHỈ ---
            let isHeartFound = false;

            if (results.landmarks.length === 2) {
                const hand1 = results.landmarks[0];
                const hand2 = results.landmarks[1];
                const thumb1 = hand1[4]; const index1 = hand1[8];
                const thumb2 = hand2[4]; const index2 = hand2[8];
                const indexDist = Math.hypot(index1.x - index2.x, index1.y - index2.y);
                const thumbDist = Math.hypot(thumb1.x - thumb2.x, thumb1.y - thumb2.y);

                if (indexDist < 0.08 && thumbDist < 0.08) {
                    isHeartFound = true;
                    handRef.current.active = false;
                }
            }

            onHeartStatus(isHeartFound);

            if (!isHeartFound && results.landmarks.length > 0) {
                const lm = results.landmarks[0];
                const thumb = lm[4]; const index = lm[8];
                
                // Cursor X, Y (-1 đến 1)
                const cursorX = (0.5 - index.x) * 2; 
                const cursorY = (0.5 - index.y) * 2;

                const distance = Math.sqrt(Math.pow(thumb.x - index.x, 2) + Math.pow(thumb.y - index.y, 2));

                handRef.current = { active: true, x: cursorX, y: cursorY, distance: distance };

                // Tính tốc độ xoay X và Y
                const deadzone = 0.1;
                let speedX = 0;
                let speedY = 0;

                if (Math.abs(cursorX) > deadzone) speedX = cursorX * 0.03;
                if (Math.abs(cursorY) > deadzone) speedY = cursorY * 0.03;

                onMove({ x: speedX, y: speedY });

                // --- DOUBLE CLENCH DETECTION (ĐÓNG MỞ 2 LẦN) ---
                if (results.gestures.length > 0 && results.gestures[0].length > 0) {
                     const currentGesture = results.gestures[0][0].categoryName;
                     
                     // Phát hiện khi chuyển từ Nắm (Closed_Fist) sang Mở (Open_Palm)
                     if (currentGesture === "Open_Palm" && lastGesture.current === "Closed_Fist") {
                         const now = Date.now();
                         if (now - lastTime.current < 1000) { // Nếu lần 2 trong vòng 1 giây
                             clickCount.current += 1;
                         } else {
                             clickCount.current = 1; // Reset đếm nếu quá lâu
                         }
                         lastTime.current = now;

                         if (clickCount.current === 2) {
                             // Kích hoạt Toggle
                             onGesture((s: string) => s === 'CHAOS' ? 'FORMED' : 'CHAOS');
                             clickCount.current = 0; // Reset
                         }
                     }
                     lastGesture.current = currentGesture;
                }
            } else if (!isHeartFound) { 
                handRef.current.active = false;
                onMove({ x: 0, y: 0 }); 
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode, onHeartStatus]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- Component: Music Player ---
const MusicPlayer = () => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
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
  // State cameraMovement chứa cả X và Y
  const [cameraMovement, setCameraMovement] = useState({ x: 0, y: 0 });
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [showHeart, setShowHeart] = useState(false);

  const handRef = useRef({ active: false, x: 0, y: 0, distance: 0 });

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <MusicPlayer />
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, isMobile ? 1.5 : 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows={!isMobile}>
            <Experience sceneState={sceneState} cameraMovement={cameraMovement} handRef={handRef} showHeart={showHeart} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setCameraMovement} onStatus={setAiStatus} debugMode={debugMode} handRef={handRef} onHeartStatus={setShowHeart} />

      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
            <p style={{ color: '#aaa', fontSize: '12px', lineHeight: '1.5' }}>
                👉 Move hand to Rotate Tree (Left/Right/Up/Down).<br/>
                ✊✊ <b>Close-Open 2 times to Toggle!</b>
            </p>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}