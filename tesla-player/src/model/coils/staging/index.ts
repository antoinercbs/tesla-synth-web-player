/**
 * A scene's objects (model/coils/staging/*), over what it stores (model/coils/scene-data.ts):
 * its things on the floor (PhyProp and its kinds, gathered in PhySceneThings), a
 * coil placed among them (PhyCoilPlacement), a posed coil and its arcs (PhyPosedCoil).
 */
export * from './things';
export * from './placement';
export * from './posed-coil';
export * from './stage-coil';
