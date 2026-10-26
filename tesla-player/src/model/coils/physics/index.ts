/**
 * The model of a coil (model/coils/physics/*): its sheet as a PhyCoil, its two
 * coupled circuits (PhyTank), an arc's load (PhyArcLoad), its outlet points (PhyRod,
 * PhyOutletPoint), what is grounded around it (PhyGround and its kinds, gathered
 * in PhySurroundings), the air (PhyAir).
 */
export * from './constants';
export * from './air';
export * from './rod';
export * from './arc-load';
export * from './tank';
export * from './ground';
export * from './coil';
