// Paisaje exterior de las zonas comunes, visto desde la terraza y a través de
// las ventanas: seto bajo junto a la barandilla, césped, un paseo y algunos
// árboles mediterráneos. Procedural y ligero (copas como volúmenes, no hojas).

import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Pieza } from './equipamiento';
import { azar } from '../biblioteca/generadores';
import type { Vivienda } from '../modelo/tipos';

/** Copa irregular: icosaedro deformado con ruido determinista. */
function copa( k: Pieza, mat: string, x: number, y: number, z: number, r: number, rnd: () => number, achatado = 0.8 ) {

	const ico = new THREE.IcosahedronGeometry( r, 3 );
	ico.deleteAttribute( 'normal' );
	ico.deleteAttribute( 'uv' );
	const g = mergeVertices( ico );
	const pos = g.attributes.position;
	const v = new THREE.Vector3(), fase = rnd() * 10;
	for ( let i = 0; i < pos.count; i ++ ) {

		v.fromBufferAttribute( pos, i );
		const x = v.x / r, y = v.y / r, z = v.z / r;
		const f = 0.84 + 0.22 * Math.abs( Math.sin( x * 4.1 + y * 3.3 + fase ) * Math.cos( z * 3.7 - y * 2.1 + fase ) ) + 0.06 * Math.sin( x * 11 + z * 9 + fase );
		pos.setXYZ( i, v.x * f, v.y * f * achatado, v.z * f );

	}

	g.computeVertexNormals();
	g.translate( x, y, z );
	k.add( mat, g );

}

function arbol( k: Pieza, x: number, z: number, alto: number, rnd: () => number, tipo: 'olivo' | 'pino' | 'frondoso' ) {

	const tronco = tipo === 'pino' ? 'madera:#7a6552' : 'madera:#6e5a46';
	const hoja = tipo === 'olivo' ? 'hoja:#7d8a62' : tipo === 'pino' ? 'hoja:#4f6a45' : 'hoja:#5d7a45';
	const hT = alto * ( tipo === 'pino' ? 0.7 : 0.45 );
	const inclina = ( rnd() - 0.5 ) * 0.4;
	const curva = new THREE.CatmullRomCurve3( [ new THREE.Vector3( x, 0, z ), new THREE.Vector3( x + inclina * 0.3, hT * 0.5, z ), new THREE.Vector3( x + inclina, hT, z + ( rnd() - 0.5 ) * 0.3 ) ] );
	k.add( tronco, new THREE.TubeGeometry( curva, 8, alto * 0.025, 8 ) );
	const tope = curva.getPoint( 1 );
	const nC = tipo === 'pino' ? 3 : 5;
	for ( let i = 0; i < nC; i ++ ) {

		const a = rnd() * Math.PI * 2, d = alto * ( tipo === 'pino' ? 0.18 : 0.14 ) * rnd();
		const r = alto * ( tipo === 'pino' ? 0.22 : 0.2 ) * ( 0.7 + rnd() * 0.4 );
		copa( k, hoja, tope.x + Math.cos( a ) * d, tope.y + alto * 0.12 + rnd() * alto * 0.1, tope.z + Math.sin( a ) * d, r, rnd, tipo === 'pino' ? 0.55 : 0.8 );

	}

}

export function construirPaisaje( v: Vivienda ) {

	const rnd = azar( 'paisaje' );
	const k = new Pieza();
	const xs = v.exterior.barandilla.recorrido.map( ( p ) => p[ 0 ] );
	const ySur = Math.min( ...v.exterior.barandilla.recorrido.map( ( p ) => p[ 1 ] ) );
	const x0 = Math.min( ...xs ), x1 = Math.max( ...xs );
	const z0 = - ySur; // borde sur de la terraza en mundo

	// seto bajo a lo largo de la barandilla (no tapa las vistas desde dentro)
	for ( let x = x0 - 1.5; x < x1 + 1.5; x += 0.55 ) copa( k, 'hoja:#5b7442', x + ( rnd() - 0.5 ) * 0.1, 0.2, z0 + 0.5, 0.34, rnd, 1.0 );

	// árboles de las zonas comunes, alejados para que se lean como fondo
	const arboles: [ number, number, number, 'olivo' | 'pino' | 'frondoso' ][] = [
		[ - 3.5, 6.5, 4.2, 'olivo' ], [ 2.8, 9.5, 5.5, 'frondoso' ], [ 8.2, 7.5, 4.0, 'olivo' ], [ 13.5, 10.5, 7.5, 'pino' ],
		[ 17.5, 6.0, 4.4, 'olivo' ], [ - 7.5, 12.5, 8.0, 'pino' ], [ 6.0, 15.5, 6.5, 'frondoso' ], [ 20.5, 14, 7, 'pino' ],
	];
	for ( const [ x, dz, alto, tipo ] of arboles ) arbol( k, x, z0 + dz, alto, rnd, tipo );

	// macizos de arbustos junto al paseo
	for ( let i = 0; i < 14; i ++ ) {

		const x = x0 - 4 + i * 1.6 + rnd() * 0.6;
		copa( k, i % 3 ? 'hoja:#667d4c' : 'hoja:#8a8f5c', x, 0.35, z0 + 4.1 + rnd() * 0.5, 0.45 + rnd() * 0.25, rnd, 0.9 );

	}

	const g = k.malla( 'paisaje' );
	g.traverse( ( o ) => {

		if ( ( o as THREE.Mesh ).isMesh ) o.castShadow = false;

	} );
	return g;

}
