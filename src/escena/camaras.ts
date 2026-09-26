// Vistas predefinidas y transición suave de cámara.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Vista {
	nombre: string;
	pos: [ number, number, number ];
	obj: [ number, number, number ];
	fov: number;
	interior?: boolean;
}

// Coordenadas de mundo: x este, y altura, z sur. La vivienda ocupa x 0..12.7, z -9.4..2.8.
export const VISTAS: Record<string, Vista> = {
	planta: { nombre: 'Planta', pos: [ 6.35, 30, - 3.3 ], obj: [ 6.35, 0, - 3.32 ], fov: 28 },
	aerea: { nombre: 'Aérea', pos: [ 17.5, 14.5, 9.5 ], obj: [ 6.0, 0, - 3.6 ], fov: 32 },
	salon: { nombre: 'Salón', pos: [ 3.25, 1.45, - 5.55 ], obj: [ 0.9, 1.0, - 0.9 ], fov: 64, interior: true },
	cocina: { nombre: 'Cocina', pos: [ 4.3, 1.5, - 5.05 ], obj: [ 5.4, 0.95, - 0.4 ], fov: 64, interior: true },
	dormitorio: { nombre: 'Dormitorio', pos: [ 9.85, 1.45, - 5.05 ], obj: [ 11.9, 0.7, - 1.35 ], fov: 64, interior: true },
	terraza: { nombre: 'Terraza', pos: [ 0.75, 1.55, 2.25 ], obj: [ 9.0, 1.1, - 0.4 ], fov: 58 },
};

/**
 * El fov de cada vista está pensado para pantalla apaisada (16:10). En pantallas
 * más estrechas se abre el fov vertical para conservar el ancho visible.
 */
export function fovPara( v: Vista, aspecto: number ) {

	// en vertical se aprovecha más el ancho (menos margen que en escritorio)
	const ref = THREE.MathUtils.clamp( 0.95 + ( aspecto - 0.6 ) * 1.625, 0.95, 1.6 );
	if ( aspecto >= ref ) return v.fov;
	const t = Math.tan( THREE.MathUtils.degToRad( v.fov / 2 ) ) * ( ref / aspecto );
	return Math.min( v.interior ? 95 : 80, THREE.MathUtils.radToDeg( 2 * Math.atan( t ) ) );

}

const ease = ( t: number ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2 );

export class Camarografo {

	private anim: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; o0: THREE.Vector3; o1: THREE.Vector3; f0: number; f1: number } | null = null;
	actual = 'planta';

	constructor( private cam: THREE.PerspectiveCamera, private ctrl: OrbitControls ) {}

	ir( clave: string, dur = 1.4 ) {

		const v = VISTAS[ clave ];
		this.actual = clave;
		this.anim = {
			t0: performance.now(), dur: dur * 1000,
			p0: this.cam.position.clone(), p1: new THREE.Vector3( ...v.pos ),
			o0: this.ctrl.target.clone(), o1: new THREE.Vector3( ...v.obj ),
			f0: this.cam.fov, f1: fovPara( v, this.cam.aspect ),
		};
		if ( dur <= 0 ) this.actualizar( performance.now() + 1 );

	}

	/** Reajusta el fov al cambiar el tamaño de la ventana. */
	reencuadrar() {

		if ( this.anim || ! VISTAS[ this.actual ] ) return;
		this.cam.fov = fovPara( VISTAS[ this.actual ], this.cam.aspect );
		this.cam.updateProjectionMatrix();

	}

	get animando() {

		return this.anim !== null;

	}

	actualizar( ahora: number ) {

		if ( ! this.anim ) return;
		const a = this.anim;
		const t = Math.min( 1, ( ahora - a.t0 ) / Math.max( 1, a.dur ) );
		const k = ease( t );
		this.cam.position.lerpVectors( a.p0, a.p1, k );
		// entre dos vistas interiores la cámara sube en arco para no atravesar muros
		if ( a.p0.y < 2.4 && a.p1.y < 2.4 ) this.cam.position.y += Math.sin( Math.PI * k ) * 4;
		this.ctrl.target.lerpVectors( a.o0, a.o1, k );
		this.cam.fov = a.f0 + ( a.f1 - a.f0 ) * k;
		this.cam.updateProjectionMatrix();
		if ( t >= 1 ) this.anim = null;

	}

}
