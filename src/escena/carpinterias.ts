// Puertas, balconeras y barandilla, generadas a partir de los huecos del JSON.

import * as THREE from 'three/webgpu';
import { abs, color, float, fract, mix, positionLocal, smoothstep } from 'three/tsl';
import type { Hueco, Vivienda } from '../modelo/tipos';
import { caja, unir } from '../util/geo';
import { alturaHueco } from './muros';
import * as M from './materiales';

// puertas totalmente abiertas (contra el muro): no tapan la estancia en las vistas comerciales
export const ANGULO_PUERTA = THREE.MathUtils.degToRad( 89.5 );

let MAT: ReturnType<typeof materiales> | null = null;
function materiales() {

	// hoja lacada con pantografiado horizontal (patrón supuesto: 4 ranuras)
	const y = positionLocal.y;
	const ranura = smoothstep( 0.0035, 0.0015, abs( fract( y.div( 0.42 ) ).sub( 0.5 ) ).mul( 0.42 ) )
		.mul( smoothstep( 0.3, 0.35, y ) ).mul( smoothstep( 1.95, 1.9, y ) );
	const hoja = M.material( {
		acabado: mix( color( '#f2f0eb' ), color( '#d9d6cf' ), ranura ),
		rugosidad: 0.4,
		relieve: ranura.oneMinus(),
		relieveEscala: 0.6,
		fisico: { clearcoat: 0.3, clearcoatRoughness: 0.25 },
	} );
	return {
		hoja,
		lacado: M.lacado( '#f2f0eb', 0.42 ),
		cromo: M.metalico( '#c4c6c7', 0.32 ),
		aluminio: M.material( { acabado: color( '#3a3d3f' ), rugosidad: 0.34, metal: float( 0.8 ), fisico: { clearcoat: 0.3, clearcoatRoughness: 0.25 } } ),
		vidrio: M.vidrio(),
		sate: M.sate( '#f1efea', false ),
	};

}

/** Convierte cajas en coordenadas locales de planta (lx, ly, z) a geometría de mundo local. */
const cajaLocal = ( x0: number, y0: number, x1: number, y1: number, z0: number, z1: number ) =>
	caja( Math.min( x0, x1 ), Math.min( y0, y1 ), Math.max( x0, x1 ), Math.max( y0, y1 ), z0, z1 );

function puerta( h: Hueco, v: Vivienda, m: NonNullable<typeof MAT> ) {

	const muro = v.muros.find( ( w ) => w.id === h.muro )!;
	const [ x0, y0, x1, y1 ] = muro.rect;
	const enX = h.eje === 'x';
	const hd = alturaHueco( h, v );
	const [ c0, c1 ] = enX ? [ y0, y1 ] : [ x0, x1 ]; // banda del espesor del muro
	const a = h.desde, b = h.hasta;
	const g = new THREE.Group();
	g.name = h.id;

	// en un sistema (u = a lo largo del muro, w = a través), luego se mapea a planta
	const P = ( u0: number, w0: number, u1: number, w1: number, z0: number, z1: number ) =>
		enX ? cajaLocal( u0, w0, u1, w1, z0, z1 ) : cajaLocal( w0, u0, w1, u1, z0, z1 );

	// cerco (forra el hueco) y tapajuntas a ambas caras
	const e = 0.02, tj = 0.07, tjg = 0.012;
	const marco = unir( [
		P( a, c0 - 0.005, a + e, c1 + 0.005, 0, hd ),
		P( b - e, c0 - 0.005, b, c1 + 0.005, 0, hd ),
		P( a, c0 - 0.005, b, c1 + 0.005, hd - e, hd ),
		...[ c0 - tjg, c1 ].map( ( w ) => unir( [
			P( a - tj, w, a, w + tjg, 0, hd + tj ),
			P( b, w, b + tj, w + tjg, 0, hd + tj ),
			P( a - tj, w, b + tj, w + tjg, hd, hd + tj ),
		] ) ),
	] );
	const mMarco = new THREE.Mesh( marco!, m.lacado );
	mMarco.castShadow = mMarco.receiveShadow = true;
	g.add( mMarco );

	// hoja, con pivote en la bisagra y en la cara hacia la que abre
	const esp = h.tipo === 'entrada' ? 0.07 : 0.04;
	const anchoHoja = b - a - 2 * e - 0.006;
	const altoHoja = hd - e - 0.008;
	const s = h.bisagra === 'inicio' ? 1 : - 1;
	const abrePositivo = h.abre === 'n' || h.abre === 'e';
	const uPivote = h.bisagra === 'inicio' ? a + e + 0.003 : b - e - 0.003;
	const wPivote = abrePositivo ? c1 - 0.004 : c0 + 0.004;
	const signoW = abrePositivo ? - 1 : 1; // la hoja cerrada queda dentro del muro

	const pivote = new THREE.Group();
	const hojaGeo = P( 0, 0, s * anchoHoja, signoW * esp, 0.004, altoHoja );
	const hoja = new THREE.Mesh( hojaGeo, m.hoja );
	hoja.castShadow = hoja.receiveShadow = true;
	pivote.add( hoja );

	// manillas (roseta + palanca) en ambas caras, cerca del canto libre
	const uMan = s * ( anchoHoja - 0.065 );
	const piezasManilla: THREE.BufferGeometry[] = [];
	for ( const lado of [ - 1, 1 ] ) {

		const wCara = lado === signoW ? signoW * esp : 0;
		const hacia = lado === signoW ? signoW : - signoW;
		const ros = new THREE.CylinderGeometry( 0.026, 0.026, 0.01, 24 );
		ros.rotateX( Math.PI / 2 );
		if ( ! enX ) ros.rotateY( Math.PI / 2 );
		const rp = enX ? [ uMan, 1.05, - ( wCara + hacia * 0.005 ) ] : [ wCara + hacia * 0.005, 1.05, - uMan ];
		ros.translate( rp[ 0 ], rp[ 1 ], rp[ 2 ] );
		piezasManilla.push( ros );
		const w0 = wCara + hacia * 0.01, w1 = wCara + hacia * 0.058;
		piezasManilla.push( P( uMan - 0.009, w0, uMan + 0.009, w1, 1.041, 1.059 ) );
		piezasManilla.push( P( uMan - s * 0.13, w1 - hacia * 0.018, uMan + s * 0.009, w1, 1.041, 1.059 ) );

	}

	const manillas = new THREE.Mesh( unir( piezasManilla )!, m.cromo );
	manillas.castShadow = true;
	pivote.add( manillas );

	// las puertas interiores se muestran abiertas; la de entrada, cerrada
	const giro = h.tipo === 'entrada' ? 0 : ANGULO_PUERTA;
	pivote.rotation.y = enX ? giro * s * ( abrePositivo ? 1 : - 1 ) : giro * - s * ( abrePositivo ? 1 : - 1 );
	pivote.position.copy( enX ? new THREE.Vector3( uPivote, 0, - wPivote ) : new THREE.Vector3( wPivote, 0, - uPivote ) );
	g.add( pivote );
	return g;

}

function balconera( h: Hueco, v: Vivienda, m: NonNullable<typeof MAT> ) {

	const muro = v.muros.find( ( w ) => w.id === h.muro )!;
	const [ , y0, , y1 ] = muro.rect;
	const hd = alturaHueco( h, v );
	const a = h.desde, b = h.hasta, w = b - a;
	const yF = y1 - 0.09; // plano de la carpintería, en el tercio interior del muro
	const g = new THREE.Group();
	g.name = h.id;
	const perfil = 0.055, fondo = 0.07;

	const alu: THREE.BufferGeometry[] = [];
	const vid: THREE.BufferGeometry[] = [];
	// cerco perimetral + umbral
	alu.push( caja( a, yF - fondo / 2, a + perfil, yF + fondo / 2, 0, hd ) );
	alu.push( caja( b - perfil, yF - fondo / 2, b, yF + fondo / 2, 0, hd ) );
	alu.push( caja( a, yF - fondo / 2, b, yF + fondo / 2, hd - perfil, hd ) );
	alu.push( caja( a, yF - fondo / 2 - 0.02, b, yF + fondo / 2, 0, 0.018 ) );

	const hoja = ( u0: number, u1: number, yc: number, prof: number ) => {

		const p = 0.07;
		alu.push( caja( u0, yc - prof / 2, u0 + p, yc + prof / 2, 0.018, hd - perfil ) );
		alu.push( caja( u1 - p, yc - prof / 2, u1, yc + prof / 2, 0.018, hd - perfil ) );
		alu.push( caja( u0, yc - prof / 2, u1, yc + prof / 2, 0.018, 0.018 + 0.09 ) );
		alu.push( caja( u0, yc - prof / 2, u1, yc + prof / 2, hd - perfil - p, hd - perfil ) );
		vid.push( caja( u0 + p, yc - 0.008, u1 - p, yc + 0.008, 0.108, hd - perfil - p ) );

	};

	const interior = a + perfil, exterior = b - perfil;
	const mitad = ( interior + exterior ) / 2;
	if ( h.apertura === 'corredera' ) {

		hoja( interior, mitad + 0.04, yF + 0.018, 0.032 );
		hoja( mitad - 0.04, exterior, yF - 0.018, 0.032 );

	} else {

		hoja( interior, mitad, yF, 0.06 );
		hoja( mitad, exterior, yF, 0.06 );
		// manilla oscilobatiente
		const man = caja( mitad + 0.02, yF + 0.03, mitad + 0.04, yF + 0.055, 1.0, 1.16 );
		const manilla = new THREE.Mesh( man, m.cromo );
		g.add( manilla );

	}

	// guías de la persiana (exterior)
	alu.push( caja( a, y0 + 0.005, a + 0.035, y0 + 0.06, 0, hd ) );
	alu.push( caja( b - 0.035, y0 + 0.005, b, y0 + 0.06, 0, hd ) );
	alu.push( caja( a, y0 + 0.005, b, y0 + 0.06, hd - 0.03, hd ) );

	const mAlu = new THREE.Mesh( unir( alu )!, m.aluminio );
	mAlu.castShadow = mAlu.receiveShadow = true;
	g.add( mAlu );
	const mVid = new THREE.Mesh( unir( vid )!, m.vidrio );
	mVid.renderOrder = 2;
	g.add( mVid );
	g.userData.ancho = w;
	return g;

}

function barandilla( v: Vivienda, m: NonNullable<typeof MAT> ) {

	const { recorrido, postes_x } = v.exterior.barandilla;
	const alto = v.alturas.barandilla.valor;
	const g = new THREE.Group();
	g.name = 'barandilla';
	const base: THREE.BufferGeometry[] = [], alu: THREE.BufferGeometry[] = [], vid: THREE.BufferGeometry[] = [];
	const zb = 0.08; // peto de apoyo

	for ( let i = 0; i < recorrido.length - 1; i ++ ) {

		const [ ax, ay ] = recorrido[ i ], [ bx, by ] = recorrido[ i + 1 ];
		const enX = Math.abs( bx - ax ) > Math.abs( by - ay );
		const L = ( lo: number, hi: number, grosor: number, z0: number, z1: number ) => enX
			? caja( Math.min( ax, bx ) + lo, ay - grosor / 2, Math.max( ax, bx ) + hi, ay + grosor / 2, z0, z1 )
			: caja( ax - grosor / 2, Math.min( ay, by ) + lo, ax + grosor / 2, Math.max( ay, by ) + hi, z0, z1 );
		base.push( L( - 0.1, 0.1, 0.2, - 0.02, zb ) );
		alu.push( L( - 0.02, 0.02, 0.05, zb, zb + 0.06 ) );
		vid.push( L( 0, 0, 0.012, zb + 0.06, alto - 0.02 ) );
		alu.push( L( - 0.02, 0.02, 0.05, alto - 0.03, alto ) );

		// postes: los del plano en el lado sur; en los laterales, en esquinas y a mitad
		const largo = enX ? Math.abs( bx - ax ) : Math.abs( by - ay );
		const posiciones = enX ? postes_x.map( ( x ) => x - Math.min( ax, bx ) ) : [ 0.02, largo / 2, largo - 0.02 ];
		for ( const t of posiciones ) {

			const p0 = enX ? Math.min( ax, bx ) + t : Math.min( ay, by ) + t;
			alu.push( enX ? caja( p0 - 0.02, ay - 0.02, p0 + 0.02, ay + 0.02, zb, alto ) : caja( ax - 0.02, p0 - 0.02, ax + 0.02, p0 + 0.02, zb, alto ) );

		}

	}

	const mBase = new THREE.Mesh( unir( base )!, m.sate );
	mBase.castShadow = mBase.receiveShadow = true;
	const mAlu = new THREE.Mesh( unir( alu )!, m.aluminio );
	mAlu.castShadow = mAlu.receiveShadow = true;
	const mVid = new THREE.Mesh( unir( vid )!, m.vidrio );
	mVid.renderOrder = 2;
	g.add( mBase, mAlu, mVid );
	return g;

}

export function construirCarpinterias( v: Vivienda ) {

	MAT ??= materiales();
	const g = new THREE.Group();
	g.name = 'carpinterias';
	for ( const h of v.huecos ) g.add( h.tipo === 'balconera' ? balconera( h, v, MAT ) : puerta( h, v, MAT ) );
	const baranda = barandilla( v, MAT );
	return { carpinterias: g, barandilla: baranda };

}
