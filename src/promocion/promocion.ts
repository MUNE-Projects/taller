// Promoción → Tipologías → Viviendas → Opciones.
//
// La geometría y las cámaras maestras viven en la tipología (una por
// geometría distinta). Cada vivienda aporta sus datos (referencia, planta,
// superficie, orientación, precio, opciones) y, si es simétrica, se carga
// su tipología espejada. No hay un modelo 3D por vivienda.

import datosPromocion from '../datos/promocion.json';
import datosCatalogo from '../datos/catalogo.json';
import type { Configuracion, Promocion, Tipologia, Variante, Vivienda, ViviendaPromocion } from '../modelo/tipos';
import { ejeSimetria, espejarAmbientacion, espejarTipologia, espejarVariante, espejarVivienda } from './espejo';
import type { Ambientacion } from '../biblioteca/biblioteca';
import { completarVistas } from '../escena/vistas';

export const PROMOCION = datosPromocion as unknown as Promocion;
export const CATALOGO = datosCatalogo as unknown as Configuracion;

// datos de cada tipología (src/datos/tipologias/<id>/): una carpeta por geometría
const ficheros = import.meta.glob( '../datos/tipologias/*/*.json', { eager: true, import: 'default' } ) as Record<string, unknown>;
const dato = <T>( id: string, nombre: string ) => {

	const f = ficheros[ `../datos/tipologias/${ id }/${ nombre }.json` ];
	if ( ! f ) throw new Error( `Falta ${ nombre }.json en la tipología ${ id }` );
	return f as T;

};

export interface Modelo {
	tipologia: Tipologia;
	vivienda: Vivienda;
	variantes: Variante[];
	/** Mobiliario y decoración (opcional: sin él se usan los activos predeterminados). */
	ambientacion: Ambientacion | null;
}

// versiones anteriores de la geometría (src/datos/tipologias/<id>/versiones/*.json)
const versiones = import.meta.glob( '../datos/tipologias/*/versiones/*.json', { eager: true, import: 'default' } ) as Record<string, Vivienda>;

/** Versiones guardadas de la geometría de una tipología (para comparar al actualizar planos). */
export function versionesDe( idTipologia: string ) {

	const pre = `../datos/tipologias/${ idTipologia }/versiones/`;
	return Object.entries( versiones ).filter( ( [ k ] ) => k.startsWith( pre ) ).map( ( [ k, v ] ) => ( { nombre: k.slice( pre.length ).replace( /\.json$/, '' ), vivienda: v } ) ).sort( ( a, b ) => a.nombre.localeCompare( b.nombre ) );

}

/** Geometría, variantes y cámaras de una tipología, espejadas si hace falta. */
export function cargarModelo( idTipologia: string, espejo = false ): Modelo {

	const tipologia = dato<Tipologia>( idTipologia, 'tipologia' );
	const vivienda = dato<Vivienda>( idTipologia, 'vivienda' );
	const variantes = dato<Variante[]>( idTipologia, 'variantes' );
	const ambientacion = ( ficheros[ `../datos/tipologias/${ idTipologia }/ambientacion.json` ] as Ambientacion | undefined ) ?? null;
	if ( ! espejo ) {

		const t = structuredClone( tipologia );
		completarVistas( t, vivienda );
		return { tipologia: t, vivienda, variantes, ambientacion: ambientacion && structuredClone( ambientacion ) };

	}

	const S = ejeSimetria( vivienda );
	const vEsp = espejarVivienda( vivienda, S );
	const tEsp = espejarTipologia( tipologia, S );
	completarVistas( tEsp, vEsp );
	return {
		tipologia: tEsp,
		vivienda: vEsp,
		variantes: variantes.map( ( v ) => espejarVariante( v, S ) ),
		ambientacion: ambientacion && espejarAmbientacion( ambientacion, S ),
	};

}

/**
 * Catálogo que puede personalizar una vivienda: el de la promoción, filtrado
 * por lo que admite su tipología y por las restricciones de la vivienda.
 * Una categoría con una sola opción no se muestra (no hay nada que elegir).
 */
export function catalogoPara( v: ViviendaPromocion ): Configuracion {

	const permitidas = PROMOCION.tipologias.find( ( t ) => t.id === v.tipologia )?.opciones ?? {};
	const categorias = CATALOGO.categorias.map( ( c ) => {

		const ids = v.opciones?.[ c.id ] ?? permitidas[ c.id ] ?? [];
		return { ...c, opciones: c.opciones.filter( ( o ) => ids.includes( o.id ) ) };

	} ).filter( ( c ) => c.opciones.length > 1 );
	return { ...CATALOGO, categorias };

}

/** Vivienda que se enseña en la parte pública: la primera, sin espejar. */
export const viviendaPublica = () => PROMOCION.viviendas.find( ( v ) => ! v.espejo ) ?? PROMOCION.viviendas[ 0 ];

async function sha256( texto: string ) {

	const h = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( texto ) );
	return [ ...new Uint8Array( h ) ].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

/** Normaliza lo que pega el comprador: el código o el enlace completo. */
export function extraerCodigo( entrada: string ) {

	const t = entrada.trim();
	const m = t.match( /c-[a-z0-9]{8,}/i );
	return ( m ? m[ 0 ] : t.replace( /^#/, '' ) ).toLowerCase();

}

/** ¿Es válido el código del Studio de producción? */
export async function accesoStudio( codigo: string ) {

	if ( ! codigo || ! crypto?.subtle || ! PROMOCION.studio ) return false;
	return ( await sha256( `${ PROMOCION.id }:studio:${ codigo.trim() }` ) ) === PROMOCION.studio.acceso;

}

/** Vivienda asociada a un código de acceso, o null. */
export async function resolverAcceso( codigo: string ): Promise<ViviendaPromocion | null> {

	if ( ! codigo || ! crypto?.subtle ) return null;
	const h = await sha256( `${ PROMOCION.id }:${ extraerCodigo( codigo ) }` );
	return PROMOCION.viviendas.find( ( v ) => v.acceso === h ) ?? null;

}
