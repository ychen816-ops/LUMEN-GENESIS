import React, { useEffect, useRef, useState } from 'react';
import { SoilSettings, SoilPoint, SoilBehavior, SpeciesType, HandPrediction, CreatureParams } from './types';

// Global declaration for p5 and ml5 on window
declare global {
  interface Window {
    p5: any;
    ml5: any;
  }
}

// Utility for interpolation
const lerp = (start: number, stop: number, amt: number) => {
  return amt * (stop - start) + start;
};

// ============================================================================
// COMPONENT
// ============================================================================

const App: React.FC = () => {
  // --- React State for UI ---
  const [scene, setScene] = useState<number>(0); // 0:Idle, 1:Config, 3:Growth
  const [statusText, setStatusText] = useState<string>('');
  const [soilSettings, setSoilSettings] = useState<SoilSettings>({
    threshold: 100,
    dotSize: 8,
    spacing: 4,
    shape: 'dot',
    maxPoints: 2000
  });
  const [currentSpecies, setCurrentSpecies] = useState<SpeciesType>('torus');
  const [isHandReady, setIsHandReady] = useState<boolean>(false);

  // --- Refs for P5 Logic (Mutable state outside React render cycle) ---
  const canvasRef = useRef<HTMLDivElement>(null);
  const p5Instance = useRef<any>(null);
  
  // Game State Refs
  const stateRef = useRef({
    scene: 0,
    settings: soilSettings, // SYNC: Store settings here for P5 access
    img: null as any,
    imgW: 0,
    imgH: 0,
    sourceG: null as any,
    previewDots: [] as any[],
    previewDirty: false,
    soilPoints: [] as SoilPoint[],
    creatures: [] as any[],
    soilBehavior: {
      densityFactor: 1,
      heightFactor: 1,
      thicknessFactor: 1,
      growthSpeed: 1,
      avgBrightness: 0
    } as SoilBehavior,
    growthStartFrame: 0,
    growthProgress: 0,
    soilBreathPhase: 0,
    
    // Interaction
    wind: 0,
    windTarget: 0,
    verticalInfluence: 0, // Hand Y mapped 0-1
    contraction: 0,       // 0 = Open Hand, 1 = Fist
    
    // Camera / World Rotation
    // Default View: Looking down at the "Floor" (XZ plane)
    worldRotation: { x: -0.6, y: 0 }, 
    worldRotationStart: { x: -0.6, y: 0 },
    worldZoom: 1.0,
    mouseInteraction: {
      position: { x: 0, y: 0, z: 0 },
      dragRotation: { x: 0, y: 0 },
      isDragging: false,
      dragStart: { x: 0, y: 0 },
      scrollTwist: 0,
      zoomLevel: 1.0
    },
    
    // Handpose
    handPos: null as any, 
    handReady: false,
    isFist: false,        
  });

  // Sync React State to Ref for P5
  useEffect(() => {
    stateRef.current.scene = scene;
  }, [scene]);

  useEffect(() => {
    stateRef.current.settings = soilSettings;
    stateRef.current.previewDirty = true;
  }, [soilSettings]);

  // ==========================================================================
  // P5 SKETCH DEFINITION
  // ==========================================================================
  const sketch = (p: any) => {
    let video: any;
    let handposeModel: any;

    p.setup = () => {
      const canvas = p.createCanvas(900, 600, p.WEBGL);
      canvas.parent(canvasRef.current);
      
      // Init Handpose
      video = p.createCapture(p.VIDEO);
      video.size(320, 240);
      video.hide();

      if (window.ml5) {
         handposeModel = window.ml5.handpose(video, () => {
          console.log("🤝 Handpose model ready");
        });
        handposeModel.on("predict", (predictions: HandPrediction[]) => {
          gotHands(predictions, p);
        });
      }
    };

    const gotHands = (predictions: HandPrediction[], p: any) => {
      const state = stateRef.current;
      
      if (predictions.length > 0) {
        const hand = predictions[0];
        const [x, y] = hand.landmarks[9]; // Middle finger knuckle (approx center)

        // MIRRORING LOGIC:
        // X-Axis (Left/Right):
        // Video feed: x=0 is the left edge of the camera frame (which sees the user's right side).
        // Canvas: -p.width/2 is left, p.width/2 is right.
        // To Mirror: Map 0 (Camera Left) to p.width/2 (Screen Right).
        //            Map video.width (Camera Right) to -p.width/2 (Screen Left).
        const mappedX = p.map(x, 0, video.width, p.width / 2, -p.width / 2);

        // Y-Axis (Up/Down):
        // Video feed: 0 is top, video.height is bottom.
        // Canvas WebGL: -p.height/2 is Top, p.height/2 is Bottom.
        // To Match Reality: Map 0 (Top) to -p.height/2 (Top).
        const mappedY = p.map(y, 0, video.height, -p.height / 2, p.height / 2);

        if (!state.handPos) {
          state.handPos = p.createVector(mappedX, mappedY, 0);
        } else {
          state.handPos.x = p.lerp(state.handPos.x, mappedX, 0.4);
          state.handPos.y = p.lerp(state.handPos.y, mappedY, 0.4);
        }

        const wrist = hand.landmarks[0];
        const midKnuckle = hand.landmarks[9];
        const midTip = hand.landmarks[12];
        
        const handSize = Math.hypot(midKnuckle[0] - wrist[0], midKnuckle[1] - wrist[1]);
        const tipDist = Math.hypot(midTip[0] - wrist[0], midTip[1] - wrist[1]);
        
        // Fist Detection Logic
        state.isFist = tipDist < (handSize * 1.1);
        state.handReady = true;
        setIsHandReady(true);
      } else {
        state.handReady = false;
        state.isFist = false;
        setIsHandReady(false);
      }
    };

    p.draw = () => {
      p.background(5); // Very dark background
      const state = stateRef.current;

      let posVec;
      if (state.handReady && state.handPos) {
        posVec = state.handPos.copy();
      } else {
        posVec = p.createVector(p.mouseX - p.width / 2, p.mouseY - p.height / 2, 0);
      }
      state.mouseInteraction.position = posVec;
      state.soilBreathPhase += 0.01; 

      if (state.scene === 1) {
        drawSoilConfigScene(p);
      } else if (state.scene === 3) {
        drawGrowthScene(p);
      }
    };

    p.keyPressed = () => {
      if (p.key === 's' || p.key === 'S') {
        p.saveCanvas('lumen_genesis_soil', 'png');
      }
    };

    // --- SCENE 1: CONFIG & PREVIEW ---
    const drawSoilConfigScene = (p: any) => {
      const state = stateRef.current;
      const settings = state.settings; 

      if (!state.img || !state.sourceG) return;

      // Draw background image very dim
      p.push();
      p.translate(0,0,-1); // Push back slightly
      p.imageMode(p.CENTER);
      p.tint(255, 60); 
      p.image(state.img, 0, 0, state.imgW, state.imgH);
      
      p.noStroke();
      p.fill(0, 220);
      p.rectMode(p.CENTER);
      p.rect(0, 0, state.imgW, state.imgH);
      p.pop();

      if (state.previewDirty) {
        recomputePreviewDots(p);
        state.previewDirty = false;
      }

      p.push();
      p.noStroke();
      // Preview dots color
      p.fill(120, 255, 180, 200); // Brighter electronic green

      for (let d of state.previewDots) {
        p.push();
        p.translate(d.x, d.y, 0);
        if (settings.shape === 'dot') {
          p.ellipse(0, 0, d.size, d.size);
        } else if (settings.shape === 'square') {
          p.rectMode(p.CENTER);
          p.rect(0, 0, d.size, d.size);
        } else if (settings.shape === 'line') {
          p.rectMode(p.CENTER);
          p.rect(0, 0, d.size * 1.3, Math.max(1, d.size * 0.35));
        }
        p.pop();
      }
      p.pop();
    };

    const recomputePreviewDots = (p: any) => {
      const state = stateRef.current;
      const settings = state.settings; 

      if (!state.sourceG) return;
      
      state.previewDots = [];
      const step = Math.max(1, settings.spacing);
      const threshold = settings.threshold;
      const maxSize = settings.dotSize;

      state.sourceG.loadPixels();
      if (state.sourceG.pixels.length === 0) return;

      for (let y = 0; y < state.sourceG.height; y += step) {
        for (let x = 0; x < state.sourceG.width; x += step) {
          const idx = (x + y * state.sourceG.width) * 4;
          const r = state.sourceG.pixels[idx];
          const g = state.sourceG.pixels[idx + 1];
          const b = state.sourceG.pixels[idx + 2];
          const bright = r * 0.299 + g * 0.587 + b * 0.114;

          if (bright > threshold) {
            const range = 255 - threshold;
            const norm = (bright - threshold) / (range || 1);
            const radius = norm * maxSize;
            if (radius <= 0.3) continue;

            const sx = x - state.sourceG.width / 2;
            const sy = y - state.sourceG.height / 2;
            state.previewDots.push({ x: sx, y: sy, size: radius });
          }
        }
      }
      if (state.previewDots.length > 4000) {
        state.previewDots = state.previewDots.slice(0, 4000);
      }
    };

    // --- SCENE 3: GROWTH ---
    const drawGrowthScene = (p: any) => {
      const state = stateRef.current;
      const elapsed = p.frameCount - state.growthStartFrame;
      const speed = state.soilBehavior.growthSpeed || 1;
      const g = p.constrain((elapsed / 200) * speed, 0, 1);
      state.growthProgress = g;

      const inputX = state.mouseInteraction.position.x;
      const inputY = state.mouseInteraction.position.y;
      
      // INTERACTION MAPPING
      // Hand X -> Sway (Wind)
      const handInfluenceX = p.map(inputX, -p.width / 2, p.width / 2, -1, 1);
      state.windTarget = handInfluenceX * 1.0; 
      state.wind = p.lerp(state.wind, state.windTarget, 0.05);

      // Hand Y -> Vertical Influence (Height/Pulsation)
      // Map inputY (screen space) to 0-1 range
      // Top of screen (neg Y) -> 0, Bottom (pos Y) -> 1? Or reverse?
      // User requested "Up is Up".
      // If hand is UP, inputY is negative (Top). Let's map Top to 1 (Tall/Active) or 0?
      // Usually "Raising hand" implies growth/energy.
      // Top (-height/2) -> 1. Bottom (height/2) -> 0.
      const handInfluenceY = p.map(inputY, -p.height/2, p.height/2, 1, 0); 
      state.verticalInfluence = p.lerp(state.verticalInfluence, p.constrain(handInfluenceY, 0, 1), 0.1);

      // Fist -> Contraction Factor
      const contractionTarget = state.isFist ? 1.0 : 0.0;
      state.contraction = p.lerp(state.contraction, contractionTarget, 0.1);

      // Mouse Drag -> Rotation (360 degrees allowed)
      if (state.mouseInteraction.isDragging) {
         const dx = p.mouseX - state.mouseInteraction.dragStart.x;
         const dy = p.mouseY - state.mouseInteraction.dragStart.y;
         
         // Y-Axis Rotation (Spinning) - No limits
         state.worldRotation.y = state.worldRotationStart.y + dx * 0.008;
         
         // X-Axis Rotation (Tilt) - Limited to avoid confusion
         state.worldRotation.x = p.constrain(state.worldRotationStart.x + dy * 0.005, -1.2, 0.1);
      } 
      
      state.mouseInteraction.scrollTwist *= 0.96;

      p.push();
      // Lighting
      p.ambientLight(60);
      p.pointLight(255, 255, 255, 0, -500, 500);
      p.pointLight(200, 100, 255, 500, -500, 0);
      
      p.translate(0, 50, 0); // Center the floor slightly down so crops grow up into view
      p.rotateX(state.worldRotation.x); 
      p.rotateY(state.worldRotation.y); 
      p.scale(state.worldZoom);

      // Draw the "Electronic Soil" (XZ Plane)
      drawSoilFloor(p, 1.0);

      // Draw Creatures
      for (let creature of state.creatures) {
        creature.update(
          state.growthProgress,
          state.wind,
          state.contraction, // Fist
          state.verticalInfluence, // Hand Height
          p.frameCount
        );
        creature.display(p);
      }
      p.pop();

      // Hand Cursor (Visual feedback only - Screen Space)
      if (state.handReady && state.handPos) {
          p.push();
          p.translate(state.handPos.x, state.handPos.y, 0);
          p.noFill();
          if (state.isFist) {
             p.stroke(255, 50, 50, 200); // Red when contracted
             p.strokeWeight(3);
             p.ellipse(0, 0, 40, 40);
             p.noStroke();
             p.fill(255, 50, 50, 100);
             p.ellipse(0, 0, 10, 10);
          } else {
             p.stroke(255, 255, 255, 180); // White when open
             p.strokeWeight(1);
             p.ellipse(0, 0, 50, 50);
             p.ellipse(0, 0, 8, 8);
          }
          p.pop();
      }
    };

    // Refactored to draw on XZ plane (Floor)
    const drawSoilFloor = (p: any, revealProgress: number) => {
      const state = stateRef.current;
      const settings = state.settings; 

      if (state.soilPoints.length === 0) return;

      p.push();
      p.noStroke();

      const radiusMax = settings.dotSize * 0.7; 
      const radiusMin = radiusMax * 0.3;

      for (let pt of state.soilPoints) {
        const norm = pt.n !== undefined ? pt.n : p.map(pt.b, settings.threshold, 255, 0, 1);
        const baseRadius = p.lerp(radiusMin, radiusMax, norm) * revealProgress;
        const breath = 1 + p.sin(state.soilBreathPhase + (pt.x + pt.y) * 0.01) * 0.05;
        const finalRadius = baseRadius * breath;

        // Visuals: Bright "Electronic" Blue-White
        const brightness = p.map(pt.n, 0, 1, 100, 255); 
        
        p.push();
        // MAPPING: pt.x -> x, pt.y -> z.  pt.z (noise) -> y (height)
        // Note: P5 Y is down, so we use negative Y for "up".
        // The soil is "flat" on XZ.
        p.translate(pt.x, pt.z * 1.5, pt.y); 
        
        // Rotate flat shapes to lie on the floor
        p.rotateX(p.PI / 2);

        // Electronic Soil Color
        p.fill(140, 230, 255, brightness * revealProgress * 0.8); 

        if (settings.shape === 'dot') {
          p.ellipse(0,0, finalRadius, finalRadius);
        } else if (settings.shape === 'square') {
          p.rectMode(p.CENTER);
          p.rect(0,0, finalRadius * 1.2, finalRadius * 1.2);
        } else {
          p.rectMode(p.CENTER);
          p.rect(0,0, finalRadius * 0.6, finalRadius * 2);
        }
        p.pop();
      }
      p.pop();
    };

    p.mousePressed = () => {
      if (stateRef.current.scene === 3) {
        const state = stateRef.current;
        state.mouseInteraction.isDragging = true;
        state.mouseInteraction.dragStart = { x: p.mouseX, y: p.mouseY };
        state.worldRotationStart = { ...state.worldRotation };
      }
    };

    p.mouseReleased = () => {
      stateRef.current.mouseInteraction.isDragging = false;
    };
    
    p.mouseWheel = (event: any) => {
        if (stateRef.current.scene !== 3) return false;
        const zoomDelta = -event.delta * 0.001;
        stateRef.current.worldZoom = p.constrain(stateRef.current.worldZoom + zoomDelta, 0.5, 2.2);
        return false;
    }
  };


  // ============================================================================
  // LOGIC HELPERS
  // ============================================================================

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !window.p5) return;

    const reader = new FileReader();
    reader.onload = () => {
        const p = p5Instance.current;
        if(p) {
            p.loadImage(reader.result as string, (loadedImg: any) => {
                const state = stateRef.current;
                state.img = loadedImg;
                
                const s = Math.min(900 / loadedImg.width, 600 / loadedImg.height) * 0.8;
                state.imgW = loadedImg.width * s;
                state.imgH = loadedImg.height * s;
                
                state.sourceG = p.createGraphics(Math.floor(state.imgW), Math.floor(state.imgH));
                state.sourceG.image(state.img, 0, 0, state.imgW, state.imgH);
                state.sourceG.loadPixels();
                
                // AUTO-THRESHOLD CALCULATION
                // Analyze brightness histogram to suggest a better default threshold
                let bSum = 0;
                let count = 0;
                const pix = state.sourceG.pixels;
                const skip = 4; // Sample efficiency
                for(let i=0; i < pix.length; i += 4 * skip) {
                    const r = pix[i];
                    const g = pix[i+1];
                    const b = pix[i+2];
                    bSum += r * 0.299 + g * 0.587 + b * 0.114;
                    count++;
                }
                const avgBrightness = count > 0 ? bSum / count : 128;
                
                // Set threshold slightly lower than average to ensure visible points
                const smartThreshold = Math.floor(avgBrightness * 0.7);
                
                setSoilSettings(prev => ({...prev, threshold: smartThreshold }));
                
                state.previewDirty = true;
                setScene(1);
                setStatusText("Adjust parameters -> Generate Digital Soil");
            });
        }
    };
    reader.readAsDataURL(file);
  };

  const generateDigitalSoil = () => {
    const state = stateRef.current;
    const settings = state.settings;

    state.soilPoints = [];
    if (!state.sourceG) return;

    const step = Math.max(1, settings.spacing);
    const threshold = settings.threshold;

    state.sourceG.loadPixels();
    let brightnessSum = 0;

    for (let y = 0; y < state.sourceG.height; y += step) {
      for (let x = 0; x < state.sourceG.width; x += step) {
        const idx = (x + y * state.sourceG.width) * 4;
        const r = state.sourceG.pixels[idx];
        const g = state.sourceG.pixels[idx + 1];
        const b = state.sourceG.pixels[idx + 2];
        const bright = r * 0.299 + g * 0.587 + b * 0.114;

        if (bright > threshold) {
          const range = 255 - threshold;
          const normalized = (bright - threshold) / (range || 1);
          const sx = x - state.sourceG.width / 2;
          const sy = y - state.sourceG.height / 2;
          
          state.soilPoints.push({
            x: sx, // Map to X
            y: sy, // Map to Z (Depth)
            z: Math.random() * 6 - 3, // Noise Height
            b: bright,
            n: normalized
          });
          brightnessSum += normalized;
        }
      }
    }

    if (state.soilPoints.length > settings.maxPoints) {
        for (let i = state.soilPoints.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.soilPoints[i], state.soilPoints[j]] = [state.soilPoints[j], state.soilPoints[i]];
        }
        state.soilPoints = state.soilPoints.slice(0, settings.maxPoints);
    }
    
    // Fallback if image is too dark
    if(state.soilPoints.length < 50) {
       for(let i=0; i<120; i++) {
           state.soilPoints.push({
               x: (Math.random() - 0.5) * state.imgW,
               y: (Math.random() - 0.5) * state.imgH,
               z: 0,
               b: 255, n: 1
           })
       }
    }

    const avgN = state.soilPoints.length > 0 ? brightnessSum / state.soilPoints.length : 0.5;
    state.soilBehavior = {
        densityFactor: mapRange(settings.spacing, 2, 20, 1.3, 0.5),
        heightFactor: mapRange(settings.dotSize, 2, 20, 0.7, 1.6) * mapRange(settings.threshold, 0, 255, 0.8, 1.25),
        thicknessFactor: mapRange(settings.dotSize, 2, 20, 0.7, 1.6),
        growthSpeed: mapRange(settings.threshold, 0, 255, 0.8, 1.25),
        avgBrightness: avgN
    };

    setScene(3);
    state.growthStartFrame = p5Instance.current ? p5Instance.current.frameCount : 0;
    state.growthProgress = 0;
    setupCreatures(state.soilPoints, state.soilBehavior, currentSpecies);
    setStatusText("Drag to Rotate. S to Save.");
  };

  const setupCreatures = (points: SoilPoint[], behavior: SoilBehavior, species: SpeciesType) => {
    const minPlants = 30;
    const maxPlants = 160;
    const baseCount = Math.floor(mapRange(points.length, 50, 1200, minPlants, maxPlants));
    const plantCount = Math.floor(baseCount * behavior.densityFactor);
    
    const creatures = [];
    const indices = Array.from({ length: points.length }, (_, i) => i);
    
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const useCount = Math.min(plantCount, indices.length);
    
    for (let i = 0; i < useCount; i++) {
        const p = points[indices[i]];
        const strength = p.n !== undefined ? p.n : 0.7;
        const heightFactor = lerp(0.8, 1.5, strength) * behavior.heightFactor;
        const thicknessFactor = lerp(0.8, 1.4, strength) * behavior.thicknessFactor;

        const params = { strength, heightFactor, thicknessFactor };
        
        // COORDINATE MAPPING FOR CROPS (Growing on Floor)
        // x -> x
        // y (from image) -> z
        // z (noise) -> y (vertical offset base)
        const x3d = p.x;
        const z3d = p.y; // Swap Y to Z for floor layout
        const y3d = p.z * 1.5; // Small vertical noise

        // Instantiate new Crop types
        if (species === 'torus') creatures.push(new NeonTorus(x3d, y3d, z3d, params));
        else if (species === 'mobius') creatures.push(new FluxRibbon(x3d, y3d, z3d, params)); 
        else if (species === 'knot') creatures.push(new TensorCore(x3d, y3d, z3d, params)); 
        else creatures.push(new PrismSpire(x3d, y3d, z3d, params)); // NEW CROP 4
    }
    stateRef.current.creatures = creatures;
  };

  const mapRange = (v: number, i1: number, i2: number, o1: number, o2: number) => {
      return o1 + (o2 - o1) * ((v - i1) / (i2 - i1));
  };
  
  useEffect(() => {
    if (!p5Instance.current && window.p5 && canvasRef.current) {
      p5Instance.current = new window.p5(sketch);
    }
    return () => {
      if (p5Instance.current) {
        p5Instance.current.remove();
        p5Instance.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
      if(scene === 3) {
          setupCreatures(stateRef.current.soilPoints, stateRef.current.soilBehavior, currentSpecies);
      }
  }, [currentSpecies, scene]);

  const speciesLabels: Record<string, string> = {
    'torus': 'Nebula Ring',
    'mobius': 'Flux Helix',
    'knot': 'Quantum Core',
    'hopf': 'Dream Spire'
  };

  return (
    <div className="relative flex justify-center items-center h-screen bg-black text-[#0f0] font-['Montserrat'] overflow-hidden select-none">
      
      {/* INTRO SCREEN */}
      {scene === 0 && (
        <div className="absolute top-0 left-0 w-full h-full bg-black/95 flex flex-col justify-center items-start p-12 z-20 border-2 border-[#0f0] shadow-[0_0_30px_#0f0]"
             onClick={() => setScene(1)}>
          <h1 className="text-3xl mb-5 tracking-[0.16em] uppercase shadow-[0_0_15px_#0f0]">LUMEN GENESIS</h1>
          <p className="text-sm text-[#b4ffcc] max-w-[520px] leading-relaxed my-1">
            What if nature didn’t begin with earth, but with light?
          </p>
          <p className="text-sm text-[#b4ffcc] max-w-[520px] leading-relaxed my-1">
             In this place, an image does not stay an image—it disassembles into particles, drifting down like spores or ash.
          </p>
          <p className="text-sm text-[#b4ffcc] max-w-[520px] leading-relaxed my-1">
            And when those fragments settle, they behave the way soil once did: gathering, stirring, and lifting themselves into forms that resemble nothing we have grown yet still feel strangely familiar.
          </p>
          <p className="text-sm text-[#b4ffcc] max-w-[520px] leading-relaxed mt-4 my-1">
             Offer one picture, and let its light remember how to grow.
          </p>
          <div className="absolute left-1/2 bottom-20 -translate-x-1/2 text-[13px] text-[#0f0] opacity-70 animate-pulse tracking-[0.08em] uppercase">
            CLICK ANYWHERE TO ENTER
          </div>
        </div>
      )}

      {/* CANVAS CONTAINER */}
      <div ref={canvasRef} className="border border-[#0f0] shadow-[0_0_20px_rgba(0,255,0,0.3)]"></div>

      {/* UPLOAD PANEL */}
      {scene === 1 && !stateRef.current.img && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10 bg-black/85 p-10 border-2 border-[#0f0] rounded-lg">
           <h1 className="text-2xl mb-5 tracking-[0.08em]">Upload Image</h1>
           <div className="border-2 border-dashed border-[#0f0] p-8 my-5 cursor-pointer rounded-lg hover:bg-[#0f0]/10 transition-colors"
                onClick={() => document.getElementById('fileInput')?.click()}>
              <p>📁 Click to Upload Image</p>
           </div>
           <input type="file" id="fileInput" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </div>
      )}

      {/* SOIL CONFIG PANEL */}
      {scene === 1 && stateRef.current.img && (
          <div className="absolute top-4 right-4 bg-black/90 border border-[#0f0] rounded-lg p-4 z-[6] min-w-[260px] shadow-[0_0_18px_rgba(0,255,0,0.25)]">
             <h3 className="text-[11px] mb-2 tracking-[0.12em] uppercase text-[#9f9]">Digital Soil · Halftone Settings</h3>
             
             <ControlSlider label="Highlight Threshold" val={soilSettings.threshold} min={0} max={255} 
                onChange={v => setSoilSettings({...soilSettings, threshold: v})} />
             <ControlSlider label="Dot Max Size" val={soilSettings.dotSize} min={2} max={20} 
                onChange={v => setSoilSettings({...soilSettings, dotSize: v})} />
             <ControlSlider label="Grid Spacing" val={soilSettings.spacing} min={2} max={20} 
                onChange={v => setSoilSettings({...soilSettings, spacing: v})} />

             <div className="mb-2">
                 <label className="block mb-1 text-[10px] tracking-[0.05em] uppercase text-[#b4ffcc]">Shape</label>
                 <select className="w-full bg-black text-[#0f0] border border-[#0f0] rounded px-1 py-1 text-[10px]"
                    value={soilSettings.shape}
                    onChange={(e) => setSoilSettings({...soilSettings, shape: e.target.value as any})}>
                    <option value="dot">Dot</option>
                    <option value="square">Square</option>
                    <option value="line">Line</option>
                 </select>
             </div>

             <button onClick={generateDigitalSoil}
                className="w-full mt-2 bg-[#0f0] text-black border-none py-2 rounded font-bold text-[10px] tracking-[0.08em] uppercase hover:bg-[#b4ffcc] transition-colors">
                Generate Digital Soil
             </button>
          </div>
      )}

      {/* SPECIES SELECTOR */}
      {scene === 3 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/90 px-4 py-3 border border-[#0f0] rounded-lg z-[5] flex flex-col items-center">
           <div className="text-[10px] mb-2 tracking-[0.08em] uppercase text-[#9f9]">Select Life Form</div>
           <div className="flex gap-2">
               {['torus', 'mobius', 'knot', 'hopf'].map(s => (
                   <button key={s} 
                     onClick={() => setCurrentSpecies(s as SpeciesType)}
                     className={`border border-[#0f0] px-3 py-1.5 rounded text-[10px] uppercase tracking-[0.06em] min-w-[90px]
                        ${currentSpecies === s ? 'bg-[#0f0] text-black font-bold' : 'bg-black text-[#0f0] hover:bg-[#0f0]/20'}`}>
                      {speciesLabels[s]}
                   </button>
               ))}
           </div>
        </div>
      )}
      
      {/* HAND GESTURE WARNING HINT - ADJUSTED */}
      {scene === 3 && !isHandReady && (
        <div className="absolute bottom-5 left-5 pointer-events-none z-30 opacity-90">
            <div className="bg-black/90 px-4 py-2 border border-[#0f0] rounded-full flex items-center gap-3 shadow-[0_0_10px_rgba(0,255,0,0.2)]">
                <span className="text-xl">✋</span>
                <span className="text-[#0f0] text-[10px] tracking-[0.15em] uppercase font-semibold">
                    Show Hand to Interact
                </span>
            </div>
        </div>
      )}

      {/* INSTRUCTIONS */}
      {scene === 3 && (
          <div className="absolute bottom-5 right-5 p-3 bg-black/80 border border-[#0f0] rounded-lg z-[5] text-[11px]">
             <h3 className="text-[#9f9] mb-1 tracking-[0.08em] uppercase">Controls</h3>
             <p className="my-0.5">✋ Hand Open: Expand</p>
             <p className="my-0.5">✊ Fist: Contract & Glow</p>
             <p className="my-0.5">👋 Hand Mov: Sway/Pulse</p>
             <p className="my-0.5">🖱 Drag: Rotate 360°</p>
          </div>
      )}
      
      {/* SAVE BUTTON UI */}
      {scene === 3 && (
          <div className="absolute top-5 right-5 z-[5] bg-black/80 border border-[#0f0] rounded px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[#0f0]/20 transition"
               onClick={() => p5Instance.current?.saveCanvas('lumen_genesis', 'png')}>
              <span className="text-lg">💾</span>
              <span className="text-[10px] uppercase tracking-wider text-[#9f9]">Press 'S' to Save</span>
          </div>
      )}
      
      {/* HOME BTN */}
      {scene !== 0 && (
          <button onClick={() => window.location.reload()}
             className="absolute top-5 left-5 z-[5] bg-black/80 border border-[#0f0] rounded px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[#0f0]/20 transition text-[#0f0]">
             <span className="text-lg">«</span>
             <span className="text-[10px] uppercase tracking-wider text-[#9f9]">Back to Upload</span>
          </button>
      )}

    </div>
  );
};

// ============================================================================
// SUB-COMPONENTS & HELPERS
// ============================================================================

const ControlSlider: React.FC<{label: string, val: number, min: number, max: number, onChange: (v: number) => void}> = 
  ({label, val, min, max, onChange}) => (
    <label className="block mb-2 text-[10px] tracking-[0.05em] uppercase text-[#b4ffcc]">
       {label}
       <div className="flex items-center">
         <input type="range" min={min} max={max} value={val} 
           onChange={(e) => onChange(parseInt(e.target.value))} 
           className="w-full mr-2 accent-[#0f0]" />
         <span className="text-[#9f9] w-6 text-right">{val}</span>
       </div>
    </label>
);

// ============================================================================
// CREATURE CLASSES - NEON TOPOLOGICAL ORGANISMS
// ============================================================================

class Creature {
    baseX: number; baseY: number; baseZ: number;
    strength: number; heightBase: number; radiusBase: number; thickness: number;
    growth = 0; wind = 0; contraction = 0; verticalInf = 0; time = 0;
    hueOffset = 0; 
    
    constructor(x: number, y: number, z: number, params: CreatureParams) {
        this.baseX = x; this.baseY = y; this.baseZ = z; // NOTE: In XZ floor logic, Y is height
        this.strength = params.strength;
        this.heightBase = 100; 
        this.radiusBase = 10; 
        this.thickness = 1;
        this.hueOffset = (Math.random() - 0.5) * 30; 
    }
    update(growth: number, wind: number, contraction: number, verticalInf: number, frame: number) {
        this.growth = growth;
        this.wind = wind;
        this.contraction = contraction; // 0 = Open, 1 = Fist
        this.verticalInf = verticalInf;
        this.time = frame * 0.03; 
    }
    display(p: any) {}
}

// 1. NEON TORUS -> NEBULA RING
// Brighter Electric Blue
class NeonTorus extends Creature {
    rings: number;
    constructor(x: number, y: number, z: number, params: CreatureParams) {
        super(x,y,z,params);
        this.heightBase = lerp(80, 160, this.strength) * params.heightFactor;
        this.radiusBase = lerp(12, 24, this.strength) * params.thicknessFactor;
        this.rings = Math.floor(lerp(3, 8, this.strength));
    }
    display(p: any) {
        if (this.growth <= 0.01) return;
        p.push();
        p.translate(this.baseX, this.baseY, this.baseZ); 
        
        p.colorMode(p.HSB);
        p.noFill();
        
        const expansion = (1 - this.contraction) * 1.5 + 0.5; 
        const glow = this.contraction * 50; 
        const stackHeight = this.heightBase * (1 + this.verticalInf * 0.5);
        
        for (let i = 0; i < this.rings; i++) {
            const t = i / this.rings;
            const progress = t * this.growth;
            
            const y = -progress * stackHeight;
            const radius = this.radiusBase * expansion * p.sin(progress * p.PI + this.time);
            
            const swayX = p.sin(this.time + t * 2) * this.wind * 15;
            const swayZ = p.cos(this.time + t * 2) * this.wind * 15;
            
            // Shift to brighter Electric Cyan/Blue (190-210)
            const hue = (190 + t * 40 + this.hueOffset) % 360;
            const sat = 90 - glow; 
            const bri = 100; // Max brightness
            const alpha = p.map(t, 0, 1, 0.4, 0.95);

            p.strokeWeight((2 + glow * 0.1) * this.strength);
            p.stroke(hue, sat, bri, alpha);
            
            p.push();
            p.translate(swayX, y, swayZ);
            p.rotateX(p.PI / 2); 
            p.ellipse(0, 0, radius, radius);
            p.pop();
        }
        p.colorMode(p.RGB);
        p.pop();
    }
}

// 2. FLUX RIBBON -> FLUX HELIX
// Dynamic Gradient: Violet -> Red/Magenta
class FluxRibbon extends Creature {
    particles: {offset: number, speed: number}[];
    
    constructor(x: number, y: number, z: number, params: CreatureParams) {
        super(x,y,z,params);
        this.heightBase = lerp(70, 150, this.strength) * params.heightFactor;
        this.radiusBase = lerp(8, 16, this.strength) * params.thicknessFactor;
        
        this.particles = [];
        for(let i=0; i<3; i++) {
            this.particles.push({
                offset: Math.random() * Math.PI * 2,
                speed: 1 + Math.random()
            });
        }
    }
    display(p: any) {
        if (this.growth <= 0.01) return;
        p.push();
        p.translate(this.baseX, this.baseY, this.baseZ);
        p.colorMode(p.HSB);
        
        const steps = 30; // More steps for smoother gradient
        const visible = Math.floor(steps * this.growth);
        const width = this.radiusBase * ((1 - this.contraction) * 1.2 + 0.4);

        // Draw Ribbon
        p.noStroke();
        for(let offset = 0; offset < 2; offset++) {
            p.beginShape(p.TRIANGLE_STRIP);
            for(let i=0; i<=visible; i++) {
                const t = i/steps;
                const y = -t * this.heightBase;
                
                const wave = p.sin(t * Math.PI * 2 * 2 + this.time * 2 + offset * p.PI);
                const angle = t * Math.PI * 2 * 1.5 + this.wind * wave; 

                const swayX = p.sin(this.time + t * 2) * this.wind * 10;
                const swayZ = p.cos(this.time + t * 2) * this.wind * 10;

                // Dynamic Gradient: Violet (260) -> Magenta/Red (340)
                // Add shimmering brightness oscillation
                const shimmer = p.sin(t * 20 - this.time * 5) * 15;
                const hue = (260 + t * 80 + this.hueOffset) % 360;
                const alpha = p.map(t, 0, 0.2, 0, 0.95); // Smooth fade in from root
                
                p.fill(hue, 70, 90 + shimmer, alpha); 

                const r = width * (0.8 + 0.4 * wave);
                const x1 = swayX + p.cos(angle) * r;
                const z1 = swayZ + p.sin(angle) * r;
                const x2 = swayX + p.cos(angle + 0.5) * r;
                const z2 = swayZ + p.sin(angle + 0.5) * r;

                p.vertex(x1, y, z1);
                p.vertex(x2, y, z2);
            }
            p.endShape();
        }
        
        // Draw Particles
        p.strokeWeight(2);
        for(let pt of this.particles) {
            const t = (p.frameCount * 0.01 * pt.speed + pt.offset) % 1;
            if (t > this.growth) continue;
            
            const y = -t * this.heightBase;
            const swayX = p.sin(this.time + t * 2) * this.wind * 10;
            const swayZ = p.cos(this.time + t * 2) * this.wind * 10;
            
            const angle = t * Math.PI * 2 * 3 + this.time * 3;
            const r = this.radiusBase * 2;
            
            p.stroke((280 + t * 60) % 360, 40, 100, 0.8);
            p.point(swayX + p.cos(angle) * r, y, swayZ + p.sin(angle) * r);
        }

        p.colorMode(p.RGB);
        p.pop();
    }
}

// 3. TENSOR CORE -> QUANTUM CORE
// Keep Gold/Amber
class TensorCore extends Creature {
    orbitals: any[];
    constructor(x: number, y: number, z: number, params: CreatureParams) {
        super(x,y,z,params);
        this.heightBase = lerp(60, 110, this.strength) * params.heightFactor;
        this.radiusBase = lerp(10, 20, this.strength) * params.thicknessFactor;
        
        this.orbitals = [];
        const count = Math.floor(lerp(2, 4, this.strength));
        for(let i=0; i<count; i++) {
            this.orbitals.push({
                axisX: Math.random(),
                axisY: Math.random(),
                axisZ: Math.random(),
                speed: (Math.random() + 0.5) * (Math.random() > 0.5 ? 1 : -1)
            });
        }
    }
    display(p: any) {
        if (this.growth <= 0.01) return;
        p.push();
        const floatY = -this.heightBase * 0.6 * this.growth;
        p.translate(this.baseX, this.baseY + floatY, this.baseZ);
        
        p.colorMode(p.HSB);
        p.noFill();
        
        const condense = this.contraction;
        const spinMult = 1 + condense * 4; 
        const sizeMult = 1 - condense * 0.4;
        
        p.noStroke();
        p.fill(40 + this.hueOffset, 90, 100, 0.9);
        p.sphere(3 * sizeMult);
        
        p.strokeWeight(1.5);
        for(let i=0; i<this.orbitals.length; i++) {
            const orb = this.orbitals[i];
            p.push();
            
            p.rotate(this.time * orb.speed * spinMult, [orb.axisX, orb.axisY, orb.axisZ]);
            
            const r = this.radiusBase * (1 + i * 0.3) * sizeMult * this.growth;
            p.stroke(35 + i * 10 + this.hueOffset, 90, 100, 0.8);
            
            p.beginShape();
            for(let a=0; a < Math.PI * 2; a+= p.PI/2) {
                p.vertex(p.cos(a) * r, p.sin(a) * r, 0);
            }
            p.endShape(p.CLOSE);
            p.pop();
        }
        
        p.stroke(40, 50, 100, 0.3);
        p.strokeWeight(1);
        p.line(0,0,0, 0, -floatY, 0);

        p.colorMode(p.RGB);
        p.pop();
    }
}

// 4. PRISM SPIRE -> DREAM SPIRE
// Gradient Dreamy Colors (Cyan -> Pink -> Purple)
class PrismSpire extends Creature {
    segments: number;
    rotationOffset: number;
    constructor(x: number, y: number, z: number, params: CreatureParams) {
        super(x,y,z,params);
        this.heightBase = lerp(80, 160, this.strength) * params.heightFactor;
        this.radiusBase = lerp(8, 15, this.strength) * params.thicknessFactor;
        this.segments = Math.floor(lerp(4, 9, this.strength));
        this.rotationOffset = Math.random() * (Math.PI * 2);
    }
    
    display(p: any) {
        if (this.growth <= 0.01) return;
        p.push();
        p.translate(this.baseX, this.baseY, this.baseZ);
        
        p.colorMode(p.HSB);
        p.noFill();
        
        const spinSpeed = 1 + this.contraction * 8;
        const compression = 1 - this.contraction * 0.3;
        
        const segmentHeight = (this.heightBase / this.segments) * compression;
        
        for (let i = 0; i < this.segments * this.growth; i++) {
             const t = i / this.segments;
             const y = -i * segmentHeight * (1 + this.verticalInf);
             
             const r = this.radiusBase * (1.0 - t * 0.5) * (1 + p.sin(this.time * 2 + i) * 0.2);
             
             const rot = this.time * spinSpeed + i * 0.5 + this.rotationOffset;
             
             const swayX = p.sin(this.time + i * 0.5) * this.wind * 10;
             const swayZ = p.cos(this.time + i * 0.5) * this.wind * 10;
             
             p.push();
             p.translate(swayX, y, swayZ);
             p.rotateY(rot);
             p.rotateX(p.sin(this.time + i)*0.2); 
             
             const alpha = p.map(i, 0, this.segments, 0.9, 0.4);
             
             // Dreamy Gradient: Cyan (180) -> Pink (300) -> Purple (260)
             // Cycle slowly with time
             const dreamHue = (180 + i * 20 + this.time * 20) % 360;
             
             p.stroke(dreamHue, 65, 100, alpha); // Lower Saturation for Pastel/Dreamy look
             p.strokeWeight(1.5);
             
             if (i % 2 === 0) {
                 this.drawPyramid(p, r, segmentHeight * 0.8);
             } else {
                 p.box(r, segmentHeight * 0.5, r);
             }
             
             p.pop();
             
             if (i > 0) {
                 p.stroke(dreamHue, 40, 100, 0.3);
                 p.line(swayX, y, swayZ, swayX, y + segmentHeight, swayZ);
             }
        }
        
        p.colorMode(p.RGB);
        p.pop();
    }
    
    drawPyramid(p: any, r: number, h: number) {
        p.beginShape();
        p.vertex(-r, 0, -r); p.vertex(r, 0, -r); p.vertex(r, 0, r); p.vertex(-r, 0, r);
        p.endShape(p.CLOSE);
        p.beginShape(p.TRIANGLES);
        p.vertex(-r, 0, -r); p.vertex(r, 0, -r); p.vertex(0, -h, 0);
        p.vertex(r, 0, -r); p.vertex(r, 0, r); p.vertex(0, -h, 0);
        p.vertex(r, 0, r); p.vertex(-r, 0, r); p.vertex(0, -h, 0);
        p.vertex(-r, 0, r); p.vertex(-r, 0, -r); p.vertex(0, -h, 0);
        p.endShape();
    }
}

export default App;