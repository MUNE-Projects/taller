// Vistas maestras y transición de cámara.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vista } from '../modelo/tipos';

export type { Vista };

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
	/** Se llama al terminar cada transición (para configurar la navegación). */
	alLlegar?: ( v: Readonly<Vista> ) => void;
	/** Última vista guiada (clave), para "Recentrar vista". */
	ultima = 'aerea';
	/** Cámaras maestras de la tipología cargada (congeladas). */
	vistas: Readonly<Record<string, Readonly<Vista>>> = {};
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

		const v = typeof vista === 'string' ? this.vistas[ vista ] : vista;
		if ( ! v ) return false;
		const p1 = new THREE.Vector3( ...v.pos ), o1 = new THREE.Vector3( ...v.obj );
		const f1 = fovPara( v, this.cam.aspect );
		// ¿ya está (o va) ahí? Se compara posición y dirección de la mirada, no el pivote:
		// en interior el pivote se acerca a la cámara y no coincide con el de la vista
		const destino = this.anim ? this.anim.p1 : this.cam.position;
		const dirActual = this.anim ? this.anim.o1.clone().sub( this.anim.p1 ).normalize() : this.cam.getWorldDirection( new THREE.Vector3() );
		const dirVista = o1.clone().sub( p1 ).normalize();
		this.actual = typeof vista === 'string' ? vista : v.nombre;
		if ( typeof vista === 'string' ) this.ultima = vista;
		this.vistaActual = v;
		if ( destino.distanceTo( p1 ) < 0.05 && dirActual.dot( dirVista ) > 0.9995 ) {

			if ( ! this.anim ) this.alLlegar?.( v );
			return false;

		}

		// durante una transición guiada no rigen los límites de la navegación libre
		// (distancias y ángulos del modo anterior); se vuelven a fijar al llegar
		const c = this.ctrl;
		c.minDistance = 0; c.maxDistance = Infinity; c.minPolarAngle = 0; c.maxPolarAngle = Math.PI;

		const colocar = () => {

			this.anim = null;
			this.cam.position.copy( p1 );
			this.ctrl.target.copy( o1 );
			this.cam.fov = f1;
			this.cam.updateProjectionMatrix();
			this.ctrl.update();
			this.alLlegar?.( v );

		};

		if ( instantaneo || this.reducido ) {

			colocar();
			return true;

		}

		// si alguno de los dos extremos está a la altura de los ojos se hace un fundido:
		// ni se atraviesan muros ni hay vuelos verticales desde la vista aérea
		const aPie = this.cam.position.y < ALTURA_OJOS || p1.y < ALTURA_OJOS;
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
		if ( t >= 1 ) {

			this.anim = null;
			if ( this.vistaActual ) this.alLlegar?.( this.vistaActual );

		}

	}

}
