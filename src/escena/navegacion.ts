// Navegación libre pensada para compradores (sin conocimientos de 3D).
//
// Tres modos, según dónde está la cámara:
//  - planta:   solo desplazar y acercar (sin girar): se lee como un plano.
//  - exterior: órbita alrededor de la vivienda con límites de distancia,
//              ángulo y altura; no se puede "bucear" dentro de la maqueta.
//  - interior: se mira alrededor arrastrando y se camina con la rueda (o
//              pellizco); la cámara no atraviesa muros ni entra en muebles.
//
// Todo en coordenadas de planta (x este, y norte = -z de mundo).

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Rect, Vivienda } from '../modelo/tipos';
import { puntoEnPoligono } from '../util/geo';

export type ModoNavegacion = 'planta' | 'exterior' | 'interior';

const MARGEN_MURO = 0.3;
const MARGEN_MUEBLE = 0.18;
const OJOS = { min: 1.2, max: 2.0 };

/** Distancia de un punto a un rectángulo (0 si está dentro). */
function distancia( x: number, y: number, r: Rect ) {

	const dx = Math.max( r[ 0 ] - x, 0, x - r[ 2 ] ), dy = Math.max( r[ 1 ] - y, 0, y - r[ 3 ] );
	return Math.hypot( dx, dy );

}

/** ¿Corta el segmento (a→b) al rectángulo? (Liang-Barsky) */
function cruza( ax: number, ay: number, bx: number, by: number, r: Rect ) {

	let t0 = 0, t1 = 1;
	const dx = bx - ax, dy = by - ay;
	for ( const [ p, q ] of [ [ - dx, ax - r[ 0 ] ], [ dx, r[ 2 ] - ax ], [ - dy, ay - r[ 1 ] ], [ dy, r[ 3 ] - ay ] ] ) {

		if ( p === 0 ) {

			if ( q < 0 ) return false;
			continue;

		}

		const t = q / p;
		if ( p < 0 ) t0 = Math.max( t0, t ); else t1 = Math.min( t1, t );
		if ( t0 > t1 ) return false;

	}

	return true;

}

export class Navegacion {

	modo: ModoNavegacion = 'exterior';
	private muros: Rect[] = [];
	private muebles: Rect[] = [];
	private interiores: [ number, number ][][] = [];
	private caja: Rect = [ 0, 0, 13, 10 ];
	private altura = 2.5;
	private paso = 0; // metros pendientes de caminar (rueda)
	private anterior = { pos: new THREE.Vector3(), obj: new THREE.Vector3() };

	constructor( private cam: THREE.PerspectiveCamera, private ctrl: OrbitControls, dom: HTMLElement ) {

		ctrl.enableDamping = true;
		ctrl.dampingFactor = 0.1;
		ctrl.zoomToCursor = true;
		dom.addEventListener( 'wheel', ( e ) => {

			if ( this.modo !== 'interior' ) return;
			e.preventDefault();
			this.paso += - Math.sign( e.deltaY ) * Math.min( 0.45, Math.abs( e.deltaY ) * 0.003 );

		}, { passive: false } );

	}

	/** Obstáculos de la vivienda actual (muros, pilares, mobiliario y decoración). */
	actualizarObstaculos( v: Vivienda, extra: Rect[] = [] ) {

		this.muros = v.muros.map( ( m ) => m.rect );
		this.muebles = [ ...v.equipamiento.map( ( e ) => e.rect ), ...extra ];
		this.interiores = v.estancias.filter( ( e ) => e.uso !== 'exterior' ).map( ( e ) => e.poligono );
		const xs = this.muros.flatMap( ( r ) => [ r[ 0 ], r[ 2 ] ] ), ys = this.muros.flatMap( ( r ) => [ r[ 1 ], r[ 3 ] ] );
		this.caja = [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];
		this.altura = v.alturas.libre.valor;

	}

	/** Configura los controles para un modo. En interior el pivote se pone justo delante de la cámara. */
	configurar( modo: ModoNavegacion ) {

		this.modo = modo;
		const c = this.ctrl;
		const { MOUSE, TOUCH } = THREE;
		c.enableRotate = modo !== 'planta';
		c.enableZoom = modo !== 'interior';
		c.enablePan = modo !== 'interior';
		c.screenSpacePanning = modo === 'planta';
		c.rotateSpeed = modo === 'interior' ? 0.35 : 0.55;
		c.zoomSpeed = 0.8;
		c.panSpeed = 0.7;
		c.mouseButtons = modo === 'planta'
			? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
			: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
		c.touches = modo === 'planta' ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
		if ( modo === 'planta' ) {

			c.minDistance = 10; c.maxDistance = 45;
			c.minPolarAngle = 0; c.maxPolarAngle = 0.02;

		} else if ( modo === 'exterior' ) {

			c.minDistance = 5; c.maxDistance = 40;
			c.minPolarAngle = Math.PI * 0.12; c.maxPolarAngle = Math.PI * 0.46;

		} else {

			// pivote a 0,3 m delante: girar es "mirar alrededor", no orbitar un punto lejano
			const dir = this.cam.getWorldDirection( new THREE.Vector3() );
			c.target.copy( this.cam.position ).addScaledVector( dir, 0.3 );
			c.minDistance = c.maxDistance = 0.3;
			c.minPolarAngle = Math.PI * 0.3; c.maxPolarAngle = Math.PI * 0.68;

		}

		c.update();
		this.guardar();

	}

	private guardar() {

		this.anterior.pos.copy( this.cam.position );
		this.anterior.obj.copy( this.ctrl.target );

	}

	private holgura( x: number, y: number ) {

		let d = Infinity;
		for ( const r of this.muros ) d = Math.min( d, distancia( x, y, r ) - MARGEN_MURO );
		for ( const r of this.muebles ) d = Math.min( d, distancia( x, y, r ) - MARGEN_MUEBLE );
		return d;

	}

	/** ¿Es aceptable pasar de `a` a `b` (mundo)? */
	private valido( a: THREE.Vector3, b: THREE.Vector3 ) {

		const H = this.altura;
		if ( b.y < 0.9 ) return false;
		const bx = b.x, by = - b.z, ax = a.x, ay = - a.z;
		const dentroCaja = bx > this.caja[ 0 ] - 0.2 && bx < this.caja[ 2 ] + 0.2 && by > this.caja[ 1 ] - 0.2 && by < this.caja[ 3 ] + 0.2;
		if ( this.modo === 'exterior' ) {

			// desde fuera no se entra en la maqueta por debajo del techo
			return ! ( dentroCaja && b.y < H + 0.6 );

		}

		if ( this.modo !== 'interior' ) return true;
		if ( b.y < OJOS.min || b.y > OJOS.max ) return false;
		if ( ! this.interiores.some( ( p ) => puntoEnPoligono( bx, by, p ) ) && dentroCaja ) return false;
		// no atravesar muros
		if ( this.muros.some( ( r ) => cruza( ax, ay, bx, by, r ) ) ) return false;
		// mantener distancia a muros y muebles; si ya se estaba demasiado cerca (vista
		// maestra pegada a una pared), se permite moverse siempre que no se acerque más
		const hb = this.holgura( bx, by );
		return hb >= 0 || hb >= this.holgura( ax, ay ) - 1e-4;

	}

	/** Tras actualizar los controles: aplica el paso pendiente y deshace movimientos no válidos. */
	restringir( animando: boolean ) {

		if ( animando ) {

			this.paso = 0;
			this.guardar();
			return;

		}

		// caminar (rueda) con suavizado
		if ( this.modo === 'interior' && Math.abs( this.paso ) > 0.002 ) {

			const d = this.paso * 0.2;
			this.paso -= d;
			const dir = this.cam.getWorldDirection( new THREE.Vector3() ).setY( 0 ).normalize().multiplyScalar( d );
			this.cam.position.add( dir );
			this.ctrl.target.add( dir );

		} else this.paso = 0;

		// en exterior y planta el pivote no se aleja de la vivienda
		if ( this.modo !== 'interior' ) {

			const t = this.ctrl.target;
			const lim = new THREE.Vector3(
				THREE.MathUtils.clamp( t.x, this.caja[ 0 ] - 3, this.caja[ 2 ] + 3 ),
				THREE.MathUtils.clamp( t.y, 0, 2 ),
				THREE.MathUtils.clamp( t.z, - this.caja[ 3 ] - 3, - this.caja[ 1 ] + 4 ),
			);
			if ( ! lim.equals( t ) ) {

				this.cam.position.add( lim.clone().sub( t ) );
				t.copy( lim );

			}

		}

		if ( ! this.valido( this.anterior.pos, this.cam.position ) ) {

			this.cam.position.copy( this.anterior.pos );
			this.ctrl.target.copy( this.anterior.obj );
			this.paso = 0;
			this.cam.lookAt( this.ctrl.target );

		}

		this.guardar();

	}

}
