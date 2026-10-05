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
	abs, attribute, bumpMap, clamp, float, floor, fract, hash, max, mix, mx_cell_noise_float,
	mx_fractal_noise_float, mx_noise_float, normalWorld, positionLocal, positionWorld, sin, smoothstep,
	step, uniform, vec2, vec3,
} from 'three/tsl';

type N = any; // nodos TSL: el tipado de @types/three para TSL es demasiado estricto para componer libremente

// Colores y parámetros como uniforms, no como constantes: así los materiales del
// mismo tipo generan exactamente el mismo shader (solo cambian los valores) y
// el navegador compila un programa por tipo de material, no uno por color.
// Es lo que más reduce la espera de la primera carga.
export const color = ( c: string ): N => uniform( new THREE.Color( c ) );
const valor = ( n: number ): N => uniform( n );

export const U = {
	plano: uniform( 1 ),
	acabado: uniform( 0 ),
	muros: uniform( 0 ),
	masa: uniform( 0 ),
	altura: uniform( 2.5 ),
	anchoX: uniform( 13 ),
};

// Parámetros de acabado configurables. Cada material que depende de una opción
// comercial lee estos uniforms: cambiar una opción es cambiar valores, sin
// reconstruir geometría ni recompilar shaders. Valores iniciales = opción incluida.
const uc = ( hex: string ) => uniform( new THREE.Color( hex ) );
export const P = {
	suelo: { claro: uc( '#b38c63' ), oscuro: uc( '#8c6845' ), rugosidad: uniform( 0.5 ) },
	cocina: { claro: uc( '#efeeea' ), oscuro: uc( '#efeeea' ), veta: uniform( 0 ), rugosidad: uniform( 0.5 ) },
	encimera: { base: uc( '#ecebe7' ), mota: uc( '#b9b6b0' ), densidad: uniform( 0.04 ), nube: uniform( 0.02 ), rugosidad: uniform( 0.2 ) },
	banos: { pared: uc( '#dcd8d1' ), suelo: uc( '#d6d2cb' ) },
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
	m.roughnessNode = mix( float( 0.9 ), typeof o.rugosidad === 'number' ? valor( o.rugosidad ) : ( o.rugosidad ?? float( 0.8 ) ), r );
	m.metalnessNode = mix( float( 0 ), typeof o.metal === 'number' ? valor( o.metal ) : ( o.metal ?? float( 0 ) ), r );
	if ( o.relieve ) m.normalNode = bumpMap( o.relieve.mul( r ), valor( o.relieveEscala ?? 1 ) );

	if ( o.fisico && m instanceof THREE.MeshPhysicalNodeMaterial ) {

		if ( o.fisico.sheen ) {

			m.sheenNode = ( color( o.fisico.sheenColor ?? '#ffffff' ) as N ).mul( valor( o.fisico.sheen ).mul( r ) );
			m.sheenRoughnessNode = float( 0.6 );

		}

		if ( o.fisico.clearcoat ) {

			m.clearcoatNode = valor( o.fisico.clearcoat ).mul( r );
			m.clearcoatRoughnessNode = valor( o.fisico.clearcoatRoughness ?? 0.1 );

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
export function porcelanico( tono: string | N, tam = 0.9, junta = 0.0025, rug = 0.32 ) {

	const c: N = typeof tono === 'string' ? color( tono ) : tono;

	const p = vec2( positionWorld.x, positionWorld.z );
	const [ enJunta, id ] = baldosas( p, vec2( tam, tam ), junta );
	const vetas = ruidoSuave( vec3( p.x, p.y, id.mul( 9 ) ), 1.6 ).mul( 0.5 ).add( 0.5 );
	const grano = mx_noise_float( vec3( p.mul( 90 ), 0 ) ).mul( 0.5 ).add( 0.5 );
	const base = c.mul( float( 0.975 ).add( id.mul( 0.05 ) ) ).mul( float( 0.97 ).add( vetas.mul( 0.05 ) ).add( grano.mul( 0.012 ) ) );
	const acabado = mix( base, c.mul( 0.72 ), enJunta );
	return material( {
		acabado,
		rugosidad: mix( valor( rug ).add( vetas.mul( 0.08 ) ), float( 0.9 ), enJunta ),
		relieve: enJunta.oneMinus().mul( 0.6 ),
		relieveEscala: 0.35,
		planoColor: PALETA.papel,
	} );

}

/** Alicatado de paredes (baños): pieza rectangular apaisada con brillo. */
export function alicatado( tono: string | N, creceConMuros = false ) {

	const c: N = typeof tono === 'string' ? color( tono ) : tono;
	const [ enJunta, id ] = baldosas( uvPared(), vec2( 0.6, 0.3 ), 0.002 );
	const acabado = mix( c.mul( float( 0.985 ).add( id.mul( 0.03 ) ) ), c.mul( 0.78 ), enJunta );
	return material( { acabado, rugosidad: mix( float( 0.16 ), float( 0.85 ), enJunta ), relieve: enJunta.oneMinus(), relieveEscala: 0.25, creceConMuros } );

}

/** Pintura plástica lisa con variación casi imperceptible. */
export function pintura( tono: string, conCorte = false, creceConMuros = false ) {

	const p = positionWorld;
	// pintura plástica mate: leves nubes de rodillo y grano fino que atrapan la luz rasante
	const nube = ruidoSuave( p, 1.4 ).mul( 0.5 ).add( 0.5 );
	const grano = mx_noise_float( p.mul( 260 ) ).mul( 0.5 ).add( 0.5 );
	return material( {
		acabado: color( tono ).mul( float( 0.985 ).add( nube.mul( 0.02 ) ).add( grano.mul( 0.006 ) ) ),
		rugosidad: float( 0.84 ).add( nube.mul( 0.08 ) ),
		relieve: grano.mul( 0.5 ).add( nube.mul( 0.2 ) ),
		relieveEscala: 0.06,
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
		rugosidad: valor( rug ).add( fibra.mul( 0.1 ) ),
		relieve: fibra.mul( 0.4 ),
		relieveEscala: 0.1,
		barridoLocal: false,
	} );

}

/** Encimera (cuarzo, granito o piedra) según los parámetros de P.encimera. */
export function cuarzo() {

	const e = P.encimera;
	const motas = step( float( 1 ).sub( e.densidad ), mx_cell_noise_float( positionWorld.mul( 520 ) ) );
	const nube = ruidoSuave( positionWorld, 5 ).mul( 0.5 ).add( 0.5 );
	const base = mix( e.base, e.mota, nube.mul( e.nube ).mul( 4 ) );
	return material( {
		acabado: mix( base, e.mota, motas.mul( 0.85 ) ),
		rugosidad: e.rugosidad,
		fisico: { clearcoat: 0.4, clearcoatRoughness: 0.08 },
	} );

}

/** Frentes de cocina: liso o con veta de madera según P.cocina (veta 0..1). */
export function laminadoCocina() {

	const k = P.cocina;
	const p = positionLocal;
	const deform = mx_noise_float( vec3( p.x.mul( 0.6 ), p.y.mul( 6 ), p.z.mul( 6 ) ) ).mul( 0.35 );
	const anillos = fract( p.y.mul( 14 ).add( p.z.mul( 14 ) ).add( deform.mul( 4 ) ) );
	const veta = smoothstep( 0.0, 0.5, anillos ).mul( smoothstep( 1.0, 0.5, anillos ) );
	const fibra = mx_noise_float( vec3( p.x.mul( 3 ), p.y.mul( 160 ), p.z.mul( 160 ) ) ).mul( 0.5 ).add( 0.5 );
	const madera = mix( k.oscuro, k.claro, veta.mul( 0.55 ).add( fibra.mul( 0.45 ) ) );
	return material( {
		acabado: mix( k.claro, madera, k.veta ),
		rugosidad: k.rugosidad,
		relieve: fibra.mul( k.veta ).mul( 0.4 ),
		relieveEscala: 0.1,
		fisico: { clearcoat: 0.25, clearcoatRoughness: 0.3 },
	} );

}

/** Tarima de madera en lamas de 19 x 145 cm a junta trabada, según P.suelo. */
export function tarima() {

	const s = P.suelo;
	const p = vec2( positionWorld.x, positionWorld.z );
	const ancho = 0.19, largo = 1.45;
	const fila = floor( p.y.div( ancho ) );
	const u = p.x.div( largo ).add( hash( fila.mul( 7.13 ).add( 3.0 ) ) );
	const tabla = floor( u );
	const fu = fract( u ), fv = fract( p.y.div( ancho ) );
	const jx = 0.0015 / largo, jy = 0.0015 / ancho;
	const enJunta = max(
		float( 1 ).sub( smoothstep( 0, jx, fu ).mul( smoothstep( 0, jx, float( 1 ).sub( fu ) ) ) ),
		float( 1 ).sub( smoothstep( 0, jy, fv ).mul( smoothstep( 0, jy, float( 1 ).sub( fv ) ) ) ),
	);
	const id = hash( tabla.mul( 31.7 ).add( fila.mul( 17.3 ) ).add( 5.0 ) );
	const veta = mx_noise_float( vec3( p.x.mul( 1.2 ).add( id.mul( 40 ) ), p.y.mul( 55 ), id.mul( 7 ) ) ).mul( 0.5 ).add( 0.5 );
	const fibra = mx_noise_float( vec3( p.x.mul( 6 ), p.y.mul( 420 ), id.mul( 3 ) ) ).mul( 0.5 ).add( 0.5 );
	const t = clamp( id.mul( 0.45 ).add( veta.mul( 0.4 ) ).add( fibra.mul( 0.25 ) ).sub( 0.1 ), 0, 1 );
	const madera = mix( s.oscuro, s.claro, t );
	return material( {
		acabado: mix( madera, s.oscuro.mul( 0.6 ), enJunta ),
		rugosidad: s.rugosidad.add( fibra.mul( 0.1 ) ),
		relieve: enJunta.oneMinus().mul( 0.7 ).add( fibra.mul( 0.3 ) ),
		relieveEscala: 0.25,
		// barniz satinado: brillo especular al contraluz de la ventana
		fisico: { clearcoat: 0.18, clearcoatRoughness: 0.35 },
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

/** Oscurece un color hexadecimal (f < 1) o lo aclara (f > 1). */
export function oscurecer( hex: string, f: number ) {

	const c = new THREE.Color( hex );
	c.r = Math.min( 1, c.r * f ); c.g = Math.min( 1, c.g * f ); c.b = Math.min( 1, c.b * f );
	return `#${ c.getHexString() }`;

}

/** Bouclé: tejido de rizo, relieve granulado y brillo suave. */
export function boucle( tono: string ) {

	const rizo = mx_cell_noise_float( positionWorld.mul( 260 ) );
	const grano = mx_noise_float( positionWorld.mul( 120 ) ).mul( 0.5 ).add( 0.5 );
	return material( {
		acabado: color( tono ).mul( float( 0.9 ).add( rizo.mul( 0.08 ) ).add( grano.mul( 0.06 ) ) ),
		rugosidad: 0.97,
		relieve: rizo.mul( 0.6 ).add( grano.mul( 0.4 ) ),
		relieveEscala: 0.12,
		fisico: { sheen: 0.8, sheenColor: '#ffffff' },
	} );

}

/** Mármol pulido con vetas. */
export function marmol( tono = '#eeebe6' ) {

	const p = positionWorld;
	const turb = mx_fractal_noise_float( p.mul( 3.2 ), 4, 2.0, 0.5 );
	const veta = abs( sin( p.x.mul( 4 ).add( p.z.mul( 2.5 ) ).add( turb.mul( 6 ) ) ) );
	const linea = float( 1 ).sub( smoothstep( 0.0, 0.08, veta ) );
	const nube = mx_noise_float( p.mul( 1.5 ) ).mul( 0.5 ).add( 0.5 );
	const base = color( tono ).mul( float( 0.95 ).add( nube.mul( 0.05 ) ) );
	return material( {
		acabado: mix( base, color( oscurecer( tono, 0.62 ) ), linea.mul( 0.7 ) ),
		rugosidad: 0.12,
		fisico: { clearcoat: 0.6, clearcoatRoughness: 0.06 },
	} );

}

/** Follaje: variación de tono por hoja y translucidez aparente. */
export function hoja( tono = '#4d6b3c' ) {

	const celda = mx_cell_noise_float( positionWorld.mul( 28 ) );
	const ruido = mx_noise_float( positionWorld.mul( 9 ) ).mul( 0.5 ).add( 0.5 );
	const m = material( {
		acabado: mix( color( oscurecer( tono, 0.7 ) ), color( oscurecer( tono, 1.25 ) ), celda.mul( 0.6 ).add( ruido.mul( 0.4 ) ) ),
		rugosidad: 0.6,
		relieve: celda,
		relieveEscala: 0.15,
	} );
	m.side = THREE.DoubleSide;
	return m;

}

/** Emisor (difusor de luminaria, pantalla de lámpara encendida). */
export function emisivo( tono = '#fff4e0', intensidad = 2 ) {

	const m = material( { acabado: color( tono ), rugosidad: 0.8, planoColor: PALETA.papel } );
	const plano = color( PALETA.papel ).mul( 1.12 );
	m.emissiveNode = mix( color( tono ).mul( valor( intensidad ).mul( U.acabado ) ), plano, U.plano );
	return m;

}

/** Lienzo abstracto: manchas de color con bordes pintados (no reproduce obra alguna). */
export function lienzo( tonos: string[] ) {

	const [ a = '#d9cfc0', b = '#b86f4c', c = '#39475a' ] = tonos;
	const p = positionLocal;
	const n1 = mx_fractal_noise_float( p.mul( 2.2 ), 3, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	const n2 = mx_fractal_noise_float( p.mul( 3.1 ).add( 7.3 ), 3, 2.0, 0.5 ).mul( 0.5 ).add( 0.5 );
	const pincel = mx_noise_float( vec3( p.x.mul( 60 ), p.y.mul( 8 ), p.z.mul( 60 ) ) ).mul( 0.04 );
	const t1 = smoothstep( 0.52, 0.56, n1.add( pincel ) ), t2 = smoothstep( 0.6, 0.64, n2.add( pincel ) );
	return material( {
		acabado: mix( mix( color( a ), color( b ), t1 ), color( c ), t2 ),
		rugosidad: 0.75,
		relieve: pincel.mul( 10 ),
		relieveEscala: 0.05,
		barridoLocal: false,
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
export function suelo_exterior( centro: THREE.Vector3, zCesped = Infinity ) {

	const p = vec2( positionWorld.x, positionWorld.z );
	const d = p.sub( vec2( centro.x, centro.z ) ).length();
	const lejos = smoothstep( 14, 42, d );
	const [ enJunta ] = baldosas( p, vec2( 0.6, 0.6 ), 0.004 );
	const pav = mix( color( '#c4bfb6' ), color( '#aaa59c' ), enJunta.mul( 0.8 ) ).mul( float( 0.97 ).add( ruidoSuave( vec3( p.x, p.y, 0 ), 0.6 ).mul( 0.05 ) ) );
	if ( ! Number.isFinite( zCesped ) ) return material( { acabado: mix( pav, color( '#e9e6e0' ), lejos ), rugosidad: 0.85, planoColor: PALETA.papel } );
	// zonas comunes al sur de la terraza: césped con un paseo de losas
	const manchas = ruidoSuave( vec3( p.x, p.y, 0 ), 0.35 ).mul( 0.5 ).add( 0.5 );
	const brizna = mx_noise_float( vec3( p.x.mul( 60 ), p.y.mul( 60 ), 0 ) ).mul( 0.5 ).add( 0.5 );
	const cesped = mix( color( '#6f8a4a' ), color( '#93a262' ), manchas.mul( 0.7 ).add( brizna.mul( 0.3 ) ) );
	const zc = float( zCesped );
	const esCesped = smoothstep( zc, zc.add( 0.08 ), p.y );
	const paseo = smoothstep( zc.add( 2.5 ), zc.add( 2.55 ), p.y ).mul( smoothstep( zc.add( 3.75 ), zc.add( 3.7 ), p.y ) );
	const [ juntaPaseo ] = baldosas( p, vec2( 0.9, 0.45 ), 0.012, 0.5 );
	const losas = mix( color( '#d8d0c2' ), color( '#a9a193' ), juntaPaseo.mul( 0.9 ) );
	const verde = mix( cesped, losas, paseo );
	const acabado = mix( mix( pav, verde, esCesped ), color( '#dfe0d3' ), lejos );
	return material( {
		acabado,
		rugosidad: mix( float( 0.85 ), float( 0.95 ), esCesped ),
		relieve: brizna.mul( esCesped ).mul( float( 1 ).sub( paseo ) ),
		relieveEscala: 0.2,
		planoColor: PALETA.papel,
	} );

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

