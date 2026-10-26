import type * as THREE from 'three';

/** Frees what a tree of objects holds on the GPU: its geometries, its materials and their maps, but those it shares (`kept`). */
export function disposeTree(o: THREE.Object3D, kept: (m: THREE.Material) => boolean = () => false): void {
  o.traverse((n) => {
    const mesh = n as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) {
      if (kept(x)) continue;
      (x as THREE.MeshStandardMaterial).map?.dispose();
      x.dispose();
    }
  });
}
