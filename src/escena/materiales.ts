// Materiales procedurales (TSL). Ninguna textura externa: todo sale de
// funciones de ruido y patrones calculados en el shader.
//
// Cada superficie comparte el mismo mecanismo de estados:
//   uPlano    1 = gráfico plano de planta (sin luz), 0 = iluminado
//   uAcabado  0 = maqueta blanca, 1 = acabado real (barrido oeste -> este)
//   uMuros    altura de los muros (barrido oeste -> este)
//   uMasa     altura de los volúmenes de estancias

import * as THREE from 'three/webgpu';
import {
	abs, attribute, bumpMap, clamp, color, float, floor, fract, hash, max, mix, mx_cell_noise_float,
	mx_fractal_noise_float, mx_noise_float, normalWorld, positionLocal, positionWorld, sin, smoothstep,
	step, uniform, vec2, vec3,
} from 'three/tsl';

type N = any; // nodos TSL: el tipado de @types/three para TSL es demasiado estricto para componer libremente

export const U = {
	plano: uniform( 1 ),
	acabado: uniform( 0 ),
	muros: uniform( 0 ),
	masa: uniform( 0 ),
	altura: uniform( 2.5 ),
	anchoX: uniform( 13 ),
};

export const PALETA = {
	papel: '#f5f3ef',
	poche: '#232323',
	arcilla: '#ebe8e2',
	arcillaSombra: '#dcd8d0',
	corte: '#3a3835',
};

// ------------------------------------------------------------ utilidades

/** Progreso de un barrido oeste->este: 0 antes de llegar el frente, 1 después. */
const barrido = ( u: N, suavidad = 0.18 ): N => {

	const xn = clamp( positionWorld.x.div( U.anchoX ), 0, 1 );
	return clamp( u.mul( float( 1 ).add( suavidad ) ).sub( xn ).div( suavidad ), 0, 1 );

};

const barridoLocal = ( u: N, suavidad = 0.18 ): N => {

	const xn = clamp( positionLocal.x.div( U.anchoX ), 0, 1 );
	return clamp( u.mul( float( 1 ).add( suavidad ) ).sub( xn ).div( suavidad ), 0, 1 );

};

/** Coordenada 2D sobre una pared alineada a los ejes: (recorrido horizontal, altura). */
const uvPared = (): N => {

	const horizontal = mix( positionWorld.x, positionWorld.z, step( abs( normalWorld.z ), abs( normalWorld.x ) ) );
	return vec2( horizontal, positionWorld.y );

};

/** Baldosas: devuelve [junta 0..1, id aleatorio de pieza]. */
const baldosas = ( p: N, tam: N, junta: number, desfase = 0 ): [ N, N ] => {

	const q = p.div( tam );
	const fila = floor( q.y );
	const qx = q.x.add( fila.mul( desfase ) );
	const celda = vec2( floor( qx ), fila );
	const f = vec2( fract( qx ), fract( q.y ) );
	const jx = float( junta ).div( tam.x ), jy = float( junta ).div( tam.y );
	const enJunta = max(
		float( 1 ).sub( smoothstep( 0, jx, f.x ).mul( smoothstep( 0, jx, float( 1 ).sub( f.x ) ) ) ),
		float( 1 ).sub( smoothstep( 0, jy, f.y ).mul( smoothstep( 0, jy, float( 1 ).sub( f.y ) ) ) ),
	);
	const id = hash( celda.x.mul( 37.0 ).add( celda.y.mul( 113.0 ) ).add( 17.0 ) );
	return [ enJunta, id ];

};

// ------------------------------------------------------------ fábrica

interface Opciones {
	acabado: N; // color final (nodo vec3)
	rugosidad?: N | number;
	metal?: N | number;
	relieve?: N; // altura para bump
	relieveEscala?: number;
	arcilla?: string;
	planoColor?: string;
	creceConMuros?: boolean;
	barridoLocal?: boolean;
	fisico?: { sheen?: number; sheenColor?: string; clearcoat?: number; clearcoatRoughness?: number };
	lado?: THREE.Side;
	corte?: boolean; // cara superior de muros con color de sección
}

export function material( o: Opciones ): THREE.MeshStandardNodeMaterial {

	const m = o.fisico ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
	const r = o.barridoLocal ? barridoLocal( U.acabado ) : barrido( U.acabado );

	let base: N = mix( color( o.arcilla ?? PALETA.arcilla ), o.acabado, r );
	if ( o.corte ) {

		const tapa = step( 0.5, normalWorld.y ).mul( step( U.altura.sub( 0.02 ), positionWorld.y ) );
		base = mix( base, color( PALETA.corte ), tapa.mul( r ).mul( 0.85 ) );

	}

	// el mapeo tonal comprime los blancos: el papel se compensa para salir tal cual
	const plano = color( o.planoColor ?? PALETA.papel ).mul( 1.12 );
	m.colorNode = base.mul( float( 1 ).sub( U.plano ) );
	m.emissiveNode = plano.mul( U.plano );
	m.roughnessNode = mix( float( 0.9 ), typeof o.rugosidad === 'number' ? float( o.rugosidad ) : ( o.rugosidad ?? float( 0.8 ) ), r );
	m.metalnessNode = mix( float( 0 ), typeof o.metal === 'number' ? float( o.metal ) : ( o.metal ?? float( 0 ) ), r );
	if ( o.relieve ) m.normalNode = bumpMap( o.relieve.mul( r ), float( o.relieveEscala ?? 1 ) );

	if ( o.fisico && m instanceof THREE.MeshPhysicalNodeMaterial ) {

		if ( o.fisico.sheen ) {

			m.sheenNode = ( color( o.fisico.sheenColor ?? '#ffffff' ) as N ).mul( float( o.fisico.sheen ).mul( r ) );
			m.sheenRoughnessNode = float( 0.6 );

		}

		if ( o.fisico.clearcoat ) {

			m.clearcoatNode = float( o.fisico.clearcoat ).mul( r );
			m.clearcoatRoughnessNode = float( o.fisico.clearcoatRoughness ?? 0.1 );

		}

	}

	if ( o.creceConMuros ) {

		const xn = clamp( positionLocal.x.div( U.anchoX ), 0, 1 );
		const f = clamp( U.muros.mul( 1.35 ).sub( xn.mul( 0.35 ) ), 0.004, 1 );
		const suave = f.mul( f ).mul( float( 3 ).sub( f.mul( 2 ) ) );
		// los dinteles (piezas que no arrancan del suelo) esperan bajo el forjado
		// hasta que el muro casi ha subido, y entonces encajan en su sitio
		const base = attribute( 'base', 'float' );
		const oculto = base.mul( float( 1 ).sub( smoothstep( 0.82, 1.0, f ) ) ).mul( 3 );
		m.positionNode = vec3( positionLocal.x, positionLocal.y.mul( max( suave, 0.004 ) ).sub( oculto ), positionLocal.z );

	}

	if ( o.lado !== undefined ) m.side = o.lado;
	return m;

}

// ------------------------------------------------------------ acabados

const ruidoSuave = ( p: N, escala: number ): N => mx_fractal_noise_float( p.mul( escala ), 3, 2.0, 0.5 );

/** Gres porcelánico en baldosa grande, junta fina, leve variación entre piezas. */
export function porcelanico( tono: string, tam = 0.9, junta = 0.0025, rug = 0.32 ) {

	const p = vec2( positionWorld.x, positionWorld.z );
	const [ enJunta, id ] = baldosas( p, vec2( tam, tam ), junta );
	const vetas = ruidoSuave( vec3( p.x, p.y, id.mul( 9 ) ), 1.6 ).mul( 0.5 ).add( 0.5 );
	const grano = mx_noise_float( vec3( p.mul( 90 ), 0 ) ).mul( 0.5 ).add( 0.5 );
	const base = color( tono ).mul( float( 0.975 ).add( id.mul( 0.05 ) ) ).mul( float( 0.97 ).add( vetas.mul( 0.05 ) ).add( grano.mul( 0.012 ) ) );
	const acabado = mix( base, color( tono ).mul( 0.72 ), enJunta );
	return material( {
		acabado,
		rugosidad: mix( float( rug ).add( vetas.mul( 0.08 ) ), float( 0.9 ), enJunta ),
		relieve: enJunta.oneMinus().mul( 0.6 ),
		relieveEscala: 0.35,
		planoColor: PALETA.papel,
	} );

}

/** Alicatado de paredes (baños): pieza rectangular apaisada con brillo. */
export function alicatado( tono: string, creceConMuros = false ) {

	const [ enJunta, id ] = baldosas( uvPared(), vec2( 0.6, 0.3 ), 0.002 );
	const acabado = mix( color( tono ).mul( float( 0.985 ).add( id.mul( 0.03 ) ) ), color( tono ).mul( 0.78 ), enJunta );
	return material( { acabado, rugosidad: mix( float( 0.16 ), float( 0.85 ), enJunta ), relieve: enJunta.oneMinus(), relieveEscala: 0.25, creceConMuros } );

}

/** Pintura plástica lisa con variación casi imperceptible. */
export function pintura( tono: string, conCorte = false, creceConMuros = false ) {

	const p = positionWorld;
	const v = ruidoSuave( p, 3.0 ).mul( 0.006 );
	return material( {
		acabado: color( tono ).add( v ),
		rugosidad: 0.88,
		relieve: mx_noise_float( p.mul( 220 ) ).mul( 0.15 ),
		relieveEscala: 0.05,
		corte: conCorte,
		creceConMuros,
	} );

}

/** Fachada SATE: mortero acrílico con grano fino. */
export function sate( tono: string, creceConMuros = true ) {

	const p = positionWorld;
	return material( {
		acabado: color( tono ).mul( float( 0.985 ).add( ruidoSuave( p, 1.2 ).mul( 0.02 ) ) ),
		rugosidad: 0.95,
		relieve: mx_noise_float( p.mul( 160 ) ).mul( 0.5 ),
		relieveEscala: 0.12,
		corte: true,
		creceConMuros,
	} );

}

/** Madera (roble claro) con veta a lo largo del eje x local. */
export function madera( tono = '#b99a78', oscuro = '#94765a', rug = 0.55 ) {

	const p = positionLocal;
	const deform = mx_noise_float( vec3( p.x.mul( 0.6 ), p.y.mul( 6 ), p.z.mul( 6 ) ) ).mul( 0.35 );
	const anillos = fract( p.z.mul( 18 ).add( p.y.mul( 18 ) ).add( deform.mul( 4 ) ) );
	const veta = smoothstep( 0.0, 0.5, anillos ).mul( smoothstep( 1.0, 0.5, anillos ) );
	const fibra = mx_noise_float( vec3( p.x.mul( 3 ), p.y.mul( 180 ), p.z.mul( 180 ) ) ).mul( 0.5 ).add( 0.5 );
	const t = veta.mul( 0.55 ).add( fibra.mul( 0.45 ) );
	return material( {
		acabado: mix( color( oscuro ), color( tono ), t ),
		rugosidad: float( rug ).add( fibra.mul( 0.1 ) ),
		relieve: fibra.mul( 0.4 ),
		relieveEscala: 0.1,
		barridoLocal: false,
	} );

}

/** Cuarzo compacto oscuro con árido fino brillante. */
export function cuarzo( tono = '#2b2b2c' ) {

	const p = positionWorld.mul( 520 );
	const motas = step( 0.965, mx_cell_noise_float( p ) ).mul( 0.6 );
	const nube = ruidoSuave( positionWorld, 4 ).mul( 0.04 );
	return material( {
		acabado: color( tono ).add( nube ).add( motas.mul( 0.12 ) ),
		rugosidad: float( 0.22 ).sub( motas.mul( 0.1 ) ),
		fisico: { clearcoat: 0.4, clearcoatRoughness: 0.08 },
	} );

}

/** Lacado / laminado liso. */
export const lacado = ( tono = '#f1efea', rug = 0.38 ) =>
	material( { acabado: color( tono ), rugosidad: rug, fisico: { clearcoat: 0.25, clearcoatRoughness: 0.3 } } );

/** Textil (tapicería, ropa de cama): trama fina + terciopelo. */
export function textil( tono: string, escala = 1 ) {

	const p = positionWorld.mul( 700 * escala );
	const trama = sin( p.x.add( p.z ) ).mul( sin( p.y.add( p.z.mul( 0.7 ) ) ) ).mul( 0.5 ).add( 0.5 );
	const irregular = mx_noise_float( positionWorld.mul( 40 ) ).mul( 0.5 ).add( 0.5 );
	return material( {
		acabado: color( tono ).mul( float( 0.94 ).add( irregular.mul( 0.08 ) ) ),
		rugosidad: 0.95,
		relieve: trama.mul( 0.5 ).add( irregular.mul( 0.5 ) ),
		relieveEscala: 0.06,
		fisico: { sheen: 0.6, sheenColor: '#ffffff' },
	} );

}

export const metalico = ( tono: string, rug: number ) => material( { acabado: color( tono ), rugosidad: rug, metal: 1 } );

export const ceramica = () => material( { acabado: color( '#f6f5f2' ), rugosidad: 0.1, fisico: { clearcoat: 0.8, clearcoatRoughness: 0.05 } } );

export const negroBrillo = () => material( { acabado: color( '#101112' ), rugosidad: 0.06 } );

export function vidrio( tono = '#dfe8e8', opacidad = 0.14 ) {

	const m = new THREE.MeshPhysicalNodeMaterial( { transparent: true, depthWrite: false } );
	m.colorNode = color( tono );
	m.opacityNode = mix( float( 0 ), float( opacidad ), barrido( U.acabado ).mul( 0.6 ).add( 0.4 ) ).mul( float( 1 ).sub( U.plano ) );
	m.roughnessNode = float( 0.03 );
	m.metalnessNode = float( 0 );
	m.side = THREE.DoubleSide;
	return m;

}

export function espejo() {

	return material( { acabado: color( '#d9dedf' ), rugosidad: 0.02, metal: 1 } );

}

/** Exterior: suelo de urbanización que se funde con el fondo a distancia. */
export function suelo_exterior( centro: THREE.Vector3 ) {

	const p = vec2( positionWorld.x, positionWorld.z );
	const d = p.sub( vec2( centro.x, centro.z ) ).length();
	const lejos = smoothstep( 9, 30, d );
	const [ enJunta ] = baldosas( p, vec2( 0.6, 0.6 ), 0.004 );
	const pav = mix( color( '#dcd8d0' ), color( '#c9c4bb' ), enJunta.mul( 0.8 ) ).mul( float( 0.97 ).add( ruidoSuave( vec3( p.x, p.y, 0 ), 0.6 ).mul( 0.05 ) ) );
	const m = material( { acabado: mix( pav, color( '#e9e6e0' ), lejos ), rugosidad: 0.85, planoColor: PALETA.papel } );
	return m;

}

// ------------------------------------------------------------ volúmenes (massing)

const COLORES_USO: Record<string, string> = {
	dia: '#e7c9a4',
	noche: '#b9c6d3',
	humedo: '#a9cbc6',
	servicio: '#cfc6b4',
	circulacion: '#e3ddd3',
	exterior: '#c9d3bb',
};

export function volumen( uso: string ) {

	const m = new THREE.MeshStandardNodeMaterial();
	m.colorNode = color( COLORES_USO[ uso ] ?? '#dddddd' );
	m.roughnessNode = float( 0.85 );
	m.positionNode = vec3( positionLocal.x, positionLocal.y.mul( max( U.masa, 0.001 ) ), positionLocal.z );
	return m;

}

export const colorUso = ( uso: string ) => COLORES_USO[ uso ] ?? '#dddddd';

/** Muros en modo plano: poché oscuro que pasa a su acabado en 3D. */
export function murosInterior() {

	const m = pintura( '#efede8', true, true );
	return conPoche( m );

}

export function conPoche( m: THREE.MeshStandardNodeMaterial ) {

	// En planta los muros se leen como relleno oscuro; al subir, recuperan su material.
	const poche = color( PALETA.poche );
	m.emissiveNode = poche.mul( U.plano );
	return m;

}

