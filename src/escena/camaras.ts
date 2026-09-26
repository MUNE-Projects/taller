// Vistas maestras y transición de cámara.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Vista {
	nombre: string;
	pos: [ number, number, number ];
	obj: [ number, number, number ];
	fov: number;
	interior?: boolean;
}

// CÁMARAS MAESTRAS. Coordenadas de mundo: x este, y altura, z sur (la vivienda
// ocupa x 0..12.7, z -9.4..2.8). Son la referencia para imágenes comerciales
// coherentes de la promoción: el objeto está congelado y nada las modifica en
// tiempo de ejecución. Una vista nueva se añade aquí.
export const VISTAS: Readonly<Record<string, Readonly<Vista>>> = Object.freeze( {
	// solo para el modo Plano (no aparece en la barra de vistas)
	planta: { nombre: 'Planta', pos: [ 6.35, 30, - 3.3 ], obj: [ 6.35, 0, - 3.32 ], fov: 28 },
	aerea: { nombre: 'Vista general', pos: [ 17.5, 14.5, 9.5 ], obj: [ 6.0, 0, - 3.6 ], fov: 32 },
	salon: { nombre: 'Salón', pos: [ 3.25, 1.45, - 5.55 ], obj: [ 0.9, 1.0, - 0.9 ], fov: 64, interior: true },
	cocina: { nombre: 'Cocina', pos: [ 4.3, 1.5, - 5.05 ], obj: [ 5.4, 0.95, - 0.4 ], fov: 64, interior: true },
	dormitorio: { nombre: 'Dormitorio', pos: [ 9.85, 1.45, - 5.05 ], obj: [ 11.9, 0.7, - 1.35 ], fov: 64, interior: true },
	// baño principal desde la puerta: ducha al fondo, inodoro y doble lavabo a la derecha
	bano: { nombre: 'Baño', pos: [ 10.08, 1.5, - 6.75 ], obj: [ 11.4, 1.0, - 8.55 ], fov: 70, interior: true },
	// terraza desde el suroeste, por encima de la barandilla: fachada, terraza y zona de piscina
	terraza: { nombre: 'Terraza', pos: [ - 1.9, 3.2, 5.2 ], obj: [ 4.0, 0.4, - 0.9 ], fov: 48 },
} );

/** Altura bajo la cual dos vistas se consideran "a pie de calle": se cambia con fundido. */
const ALTURA_OJOS = 2.9;

const ease = ( t: number ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2 );

export function fovPara( v: Vista, aspecto: number ) {

	// en vertical se aprovecha más el ancho (menos margen que en escritorio)
	const ref = THREE.MathUtils.clamp( 0.95 + ( aspecto - 0.6 ) * 1.625, 0.95, 1.6 );
	if ( aspecto >= ref ) return v.fov;
	const t = Math.tan( THREE.MathUtils.degToRad( v.fov / 2 ) ) * ( ref / aspecto );
	return Math.min( v.interior ? 95 : 80, THREE.MathUtils.radToDeg( 2 * Math.atan( t ) ) );

}

export class Camarografo {

	private anim: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; o0: THREE.Vector3; o1: THREE.Vector3; f0: number; f1: number } | null = null;
	private vistaActual: Vista | null = null;
	actual = 'planta';
	reducido = matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	/** `velo`: capa a pantalla completa que se funde a opaco durante un corte. */
	constructor( private cam: THREE.PerspectiveCamera, private ctrl: OrbitControls, private velo?: HTMLElement ) {}

	/**
	 * Lleva la cámara a una vista. Una sola transición, sin arcos:
	 *  - si ya está allí (o yendo allí), no hace nada;
	 *  - entre dos puntos a la altura de los ojos, fundido breve (no atraviesa muros);
	 *  - en otro caso, desplazamiento suave con duración según la distancia.
	 * Devuelve false si no hubo movimiento.
	 */
	ir( vista: string | Vista, instantaneo = false ) {

		const v = typeof vista === 'string' ? VISTAS[ vista ] : vista;
		if ( ! v ) return false;
		const p1 = new THREE.Vector3( ...v.pos ), o1 = new THREE.Vector3( ...v.obj );
		const f1 = fovPara( v, this.cam.aspect );
		const destino = this.anim ? this.anim.p1 : this.cam.position;
		const objetivo = this.anim ? this.anim.o1 : this.ctrl.target;
		this.actual = typeof vista === 'string' ? vista : v.nombre;
		this.vistaActual = v;
		if ( destino.distanceTo( p1 ) < 0.05 && objetivo.distanceTo( o1 ) < 0.05 ) return false;

		const colocar = () => {

			this.anim = null;
			this.cam.position.copy( p1 );
			this.ctrl.target.copy( o1 );
			this.cam.fov = f1;
			this.cam.updateProjectionMatrix();
			this.ctrl.update();

		};

		if ( instantaneo || this.reducido ) {

			colocar();
			return true;

		}

		const aPie = this.cam.position.y < ALTURA_OJOS && p1.y < ALTURA_OJOS;
		if ( aPie && this.velo ) {

			this.anim = null;
			this.velo.classList.add( 'activo' );
			setTimeout( () => {

				colocar();
				setTimeout( () => this.velo!.classList.remove( 'activo' ), 90 );

			}, 190 );
			return true;

		}

		const d = this.cam.position.distanceTo( p1 );
		this.anim = {
			t0: performance.now(), dur: THREE.MathUtils.clamp( 700 + d * 45, 800, 1600 ),
			p0: this.cam.position.clone(), p1,
			o0: this.ctrl.target.clone(), o1,
			f0: this.cam.fov, f1,
		};
		return true;

	}

	/** Reajusta el fov al cambiar el tamaño de la ventana. */
	reencuadrar() {

		if ( this.anim || ! this.vistaActual || ! this.actual ) return;
		this.cam.fov = fovPara( this.vistaActual, this.cam.aspect );
		this.cam.updateProjectionMatrix();

	}

	/** La persona ha tomado el control con el ratón: se cancela cualquier transición. */
	soltar() {

		this.anim = null;
		this.actual = '';

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
		this.ctrl.target.lerpVectors( a.o0, a.o1, k );
		this.cam.fov = a.f0 + ( a.f1 - a.f0 ) * k;
		this.cam.updateProjectionMatrix();
		if ( t >= 1 ) this.anim = null;

	}

}
