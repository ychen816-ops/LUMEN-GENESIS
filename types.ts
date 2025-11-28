export interface SoilSettings {
  threshold: number;
  dotSize: number;
  spacing: number;
  shape: 'dot' | 'square' | 'line';
  maxPoints: number;
}

export interface SoilPoint {
  x: number;
  y: number;
  z: number;
  b: number; // brightness
  n: number; // normalized brightness
}

export interface SoilBehavior {
  densityFactor: number;
  heightFactor: number;
  thicknessFactor: number;
  growthSpeed: number;
  avgBrightness: number;
}

export type SpeciesType = 'torus' | 'mobius' | 'knot' | 'hopf';

export interface CreatureParams {
  strength: number;
  heightFactor: number;
  thicknessFactor: number;
}

// Minimal type definition for p5/ml5 interaction
export type HandLandmark = [number, number, number];

export interface HandPrediction {
  landmarks: HandLandmark[];
  boundingBox: {
    topLeft: [number, number];
    bottomRight: [number, number];
  };
  annotations: any;
}