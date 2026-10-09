// Lote de planos comerciales de una promoción, para que la promotora los valide
// (Etapa 4). Lo usa herramientas/planos.mjs a través de planos.html (solo en
// producción, nunca en la web pública).
//
// Un plano por cada geometría distinta que se vende:
//  - plurifamiliar: por tipología y variante (espejo), y por cada distribución
//    alternativa que se ofrece;
//  - unifamiliar (promocion.tipo = «unifamiliar»): por vivienda.
//
// Cada plano lleva dos huellas: la del archivo (lo que se aprueba) y la de sus
// datos (geometría, superficies, marca…). Si en una versión nueva los datos no
// cambian, el plano es el mismo dibujo y su aprobación anterior sigue valiendo.

import { PROMOCION, cargarModelo } from '../promocion/promocion';
import { aplicarAlternativa } from '../configurador/alternativas';
import { planoPDF, planoPNG, type DatosPlano } from './plano';
import type { Alternativa, ViviendaPromocion } from '../modelo/tipos';

export interface PlanoLote {
	clave: string;
	titulo: string;
	detalle: string;
	viviendas: string;
	orden: number;
	huellaDatos: string;
	pdf: string; // base64
	png: string; // base64 (miniatura)
}

const base64 = async ( b: Blob ) => {

	const bytes = new Uint8Array( await b.arrayBuffer() );
	let s = '';
	for ( let i = 0; i < bytes.length; i += 0x8000 ) s += String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) );
	return btoa( s );

};

const sha256 = async ( texto: string ) => [ ...new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( texto ) ) ) ]
	.map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

const m2 = ( n: number ) => `${ n.toLocaleString( 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) } m²`;
const limpio = ( s: string ) => s.toLowerCase().normalize( 'NFD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

interface Encargo { clave: string; titulo: string; viviendas: ViviendaPromocion[]; tipologia: string; espejo: boolean; alternativa: Alternativa | null; ficha: ViviendaPromocion | null }

function encargos(): Encargo[] {

	const unifamiliar = PROMOCION.promocion.tipo === 'unifamiliar';
	const lista: Encargo[] = [];
	const alternativasDe = ( t: string ) => {

		const ofrece = PROMOCION.tipologias.find( ( x ) => x.id === t )?.opciones.distribucion?.some( ( d ) => d !== 'base' );
		return ofrece ? cargarModelo( t ).alternativas : [];

	};

	if ( unifamiliar ) {

		for ( const v of PROMOCION.viviendas ) {

			for ( const alt of [ null, ...alternativasDe( v.tipologia ) ] ) {

				lista.push( { clave: limpio( `vivienda-${ v.ref }${ alt ? `-${ alt.id }` : '' }` ), titulo: `Vivienda ${ v.ref }${ alt ? ` · ${ alt.nombre }` : '' }`,
					viviendas: [ v ], tipologia: v.tipologia, espejo: v.espejo, alternativa: alt, ficha: v } );

			}

		}
		return lista;

	}

	// plurifamiliar: viviendas agrupadas por tipología y variante, en el orden de la promoción
	const grupos = new Map<string, ViviendaPromocion[]>();
	for ( const v of PROMOCION.viviendas ) {

		const k = `${ v.tipologia }|${ v.espejo ? 'espejo' : '' }`;
		grupos.set( k, [ ...( grupos.get( k ) ?? [] ), v ] );

	}
	for ( const [ k, vs ] of grupos ) {

		const [ t, variante ] = k.split( '|' );
		const nombre = cargarModelo( t ).tipologia.nombre;
		for ( const alt of [ null, ...alternativasDe( t ) ] ) {

			lista.push( {
				clave: limpio( `${ t }${ variante ? `-${ variante }` : '' }${ alt ? `-${ alt.id }` : '' }` ),
				titulo: `${ nombre }${ variante ? ` · ${ variante }` : '' }${ alt ? ` · ${ alt.nombre }` : '' }`,
				viviendas: vs, tipologia: t, espejo: variante === 'espejo', alternativa: alt, ficha: null,
			} );

		}

	}
	return lista;

}

/** Genera todos los planos (PDF A3 y miniatura PNG) con sus huellas de datos. */
export async function generarLote( avisar: ( t: string ) => void = () => {} ): Promise<PlanoLote[]> {

	const salida: PlanoLote[] = [];
	for ( const [ orden, e ] of encargos().entries() ) {

		avisar( `Plano ${ orden + 1}: ${ e.titulo }` );
		const modelo = cargarModelo( e.tipologia, e.espejo );
		// la alternativa, en su versión espejada si la vivienda lo es
		const alternativa = e.alternativa && ( modelo.alternativas.find( ( a ) => a.id === e.alternativa!.id ) ?? null );
		const { vivienda } = aplicarAlternativa( modelo.vivienda, alternativa );
		const datos: DatosPlano = {
			promocion: PROMOCION, tipologia: modelo.tipologia, vivienda, ficha: e.ficha,
			distribucion: e.alternativa ? e.alternativa.nombre : 'base',
		};
		// la misma superficie útil que figura en el plano
		const util = vivienda.estancias.filter( ( x ) => x.uso !== 'exterior' ).reduce( ( t, x ) => t + x.superficie, 0 );
		const t = modelo.tipologia;
		salida.push( {
			clave: e.clave,
			titulo: e.titulo,
			detalle: `${ t.dormitorios } dormitorio${ t.dormitorios === 1 ? '' : 's' } · ${ t.banos } baño${ t.banos === 1 ? '' : 's' } · ${ m2( util ) } útiles`,
			viviendas: e.viviendas.map( ( v ) => v.ref ).join( ', ' ),
			orden,
			huellaDatos: await sha256( JSON.stringify( { t, vivienda, ficha: e.ficha, distribucion: datos.distribucion, marca: PROMOCION.marca, promocion: PROMOCION.promocion } ) ),
			pdf: await base64( await planoPDF( datos ) ),
			png: await base64( await planoPNG( datos, 60 ) ),
		} );

	}
	return salida;

}

( window as unknown as { generarLote: typeof generarLote } ).generarLote = generarLote;
