// Documento de selección (PDF): mecanismo de formalización del MVP.
// Se genera en el navegador del comprador; no se guarda nada en ningún sistema.

import { jsPDF } from 'jspdf';
import type { Configurador } from '../configurador/configurador';
import { fmtEuros } from '../configurador/configurador';
import { fmtM2 } from '../configurador/variantes';
import type { Promocion, Tipologia, ViviendaPromocion } from '../modelo/tipos';
import { logoPNG } from '../promocion/marca';

export interface DatosDocumento {
	promocion: Promocion;
	vivienda: ViviendaPromocion;
	tipologia: Tipologia;
	conf: Configurador;
	superficieUtil: number;
	imagen: string;
	imagenDistribucion: string | null;
	tituloDistribucion: string | null;
}

type RGB = [ number, number, number ];
const rgb = ( hex: string ): RGB => {

	const n = parseInt( hex.replace( '#', '' ), 16 );
	return [ ( n >> 16 ) & 255, ( n >> 8 ) & 255, n & 255 ];

};

const TINTA: RGB = [ 28, 28, 26 ];
const GRIS: RGB = [ 110, 106, 99 ];
const GRIS_CLARO: RGB = [ 150, 145, 137 ];
const LINEA: RGB = [ 222, 219, 213 ];
const A4 = { ancho: 210, alto: 297 };
const M = 18; // margen

export async function generarPDF( d: DatosDocumento ): Promise<Blob> {

	const { promocion: p, vivienda: v, tipologia: t, conf } = d;
	const marca = p.marca;
	const acento = rgb( marca.colorPrincipal );
	const suave: RGB = acento.map( ( x ) => Math.round( x + ( 255 - x ) * 0.9 ) ) as RGB;
	const doc = new jsPDF( { unit: 'mm', format: 'a4', compress: true } );
	const logo = await logoPNG( marca, 120 );
	const ahora = new Date();
	const fecha = ahora.toLocaleDateString( 'es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' } );
	const hora = ahora.toLocaleTimeString( 'es-ES', { hour: '2-digit', minute: '2-digit' } );
	const anchoUtil = A4.ancho - 2 * M;

	const color = ( c: RGB ) => doc.setTextColor( c[ 0 ], c[ 1 ], c[ 2 ] );
	const texto = ( s: string | string[], x: number, y: number, tam: number, c: RGB = TINTA, estilo: 'normal' | 'bold' = 'normal', opciones: Parameters<jsPDF[ 'text' ]>[ 3 ] = {} ) => {

		doc.setFont( 'helvetica', estilo );
		doc.setFontSize( tam );
		color( c );
		doc.text( s, x, y, opciones );

	};

	/** Parte un texto en líneas para un ancho dado, con el tamaño con el que se va a escribir. */
	const partir = ( s: string, ancho: number, tam: number ) => {

		doc.setFont( 'helvetica', 'normal' );
		doc.setFontSize( tam );
		return doc.splitTextToSize( s, ancho ) as string[];

	};

	const linea = ( x1: number, y1: number, x2: number, y2: number, c: RGB = LINEA, grosor = 0.2 ) => {

		doc.setDrawColor( c[ 0 ], c[ 1 ], c[ 2 ] );
		doc.setLineWidth( grosor );
		doc.line( x1, y1, x2, y2 );

	};

	const cabecera = () => {

		const alto = 10;
		doc.addImage( logo.url, 'PNG', M, 12, alto * logo.ancho / logo.alto, alto );
		texto( 'DOCUMENTO DE SELECCIÓN', A4.ancho - M, 16, 7.5, acento, 'bold', { align: 'right', charSpace: 0.4 } );
		texto( `${ p.promocion.nombre } · ${ v.ref }`, A4.ancho - M, 21, 8.5, GRIS, 'normal', { align: 'right' } );
		linea( M, 27, A4.ancho - M, 27, acento, 0.5 );

	};

	// ---------------------------------------------------------------- página 1
	cabecera();
	let y = 41;
	texto( p.promocion.nombre, M, y, 22, TINTA, 'bold' );
	y += 6.5;
	texto( `${ p.promocion.ubicacion } · ${ marca.promotora }`, M, y, 9.5, GRIS );

	// ficha de la vivienda
	y += 9;
	const fichas: [ string, string, string ][] = [
		[ 'Vivienda', v.ref, [ v.portal ? `Portal ${ v.portal }` : '', `Planta ${ v.planta.toLowerCase() }` ].filter( Boolean ).join( ' · ' ) ],
		[ 'Tipología', t.nombre, `${ t.dormitorios } dormitorios · ${ t.banos } baños` ],
		[ 'Superficie útil', fmtM2( d.superficieUtil ), `Construida ${ fmtM2( v.superficies.construida ) }` ],
		[ 'Exterior', fmtM2( v.superficies.exterior ), `Orientación ${ v.orientacion.toLowerCase() }` ],
	];
	const col = anchoUtil / fichas.length;
	fichas.forEach( ( [ etiqueta, valor, extra ], i ) => {

		const x = M + i * col;
		if ( i > 0 ) linea( x - 3, y - 3, x - 3, y + 12 );
		texto( etiqueta.toUpperCase(), x, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
		texto( valor, x, y + 5.5, 11, TINTA, 'bold' );
		texto( extra, x, y + 10.5, 7.5, GRIS );

	} );

	// imagen principal
	y += 18;
	const altoImg = anchoUtil * 10 / 16;
	doc.addImage( d.imagen, 'JPEG', M, y, anchoUtil, altoImg, undefined, 'FAST' );
	y += altoImg + 4.5;
	texto( partir( `Tu vivienda con la selección aplicada. ${ marca.legal.imagenes }`, anchoUtil, 7 ), M, y, 7, GRIS_CLARO );

	// selección
	y += 11;
	texto( 'Tu selección', M, y, 13, TINTA, 'bold' );
	y += 4;
	for ( const c of conf.datos.categorias ) {

		const o = conf.opcion( c.id );
		const alto = o.detalle ? 11 : 9;
		linea( M, y, A4.ancho - M, y );
		texto( c.nombre, M, y + 6, 8.5, GRIS );
		texto( o.nombre, M + 38, y + 6, 10, TINTA, o.precio > 0 ? 'bold' : 'normal' );
		if ( o.detalle ) texto( o.detalle, M + 38, y + 10, 7.5, GRIS );
		texto( o.precio > 0 ? `+${ fmtEuros( o.precio ) }` : 'Incluido', A4.ancho - M, y + 6, 10, o.precio > 0 ? acento : GRIS_CLARO, o.precio > 0 ? 'bold' : 'normal', { align: 'right' } );
		y += alto;

	}

	linea( M, y, A4.ancho - M, y );

	// ---------------------------------------------------------------- página 2
	doc.addPage();
	cabecera();
	y = 38;

	if ( d.imagenDistribucion ) {

		texto( 'Distribución seleccionada', M, y, 13, TINTA, 'bold' );
		y += 4;
		const alto = anchoUtil * 9 / 16;
		doc.addImage( d.imagenDistribucion, 'JPEG', M, y, anchoUtil * 0.62, alto * 0.62, undefined, 'FAST' );
		const xT = M + anchoUtil * 0.62 + 6;
		const opcion = conf.opcion( 'distribucion' );
		texto( opcion.detalle ?? opcion.nombre, xT, y + 5, 10.5, TINTA, 'bold' );
		texto( partir( `${ d.tituloDistribucion ?? '' }. Vista interior que muestra el cambio respecto a la distribución base.`, anchoUtil * 0.38 - 6, 8 ), xT, y + 11, 8, GRIS );
		y += alto * 0.62 + 10;

	}

	// precio
	texto( 'Resumen económico', M, y, 13, TINTA, 'bold' );
	y += 5;
	const filasPrecio: [ string, string ][] = [
		[ 'Precio base de la vivienda', fmtEuros( conf.precioBase ) ],
		...conf.extras.map( ( x ): [ string, string ] => [ `${ x.categoria.nombre }: ${ x.opcion.nombre }`, `+${ fmtEuros( x.opcion.precio ) }` ] ),
		[ `Total mejoras (${ conf.extras.length })`, `+${ fmtEuros( conf.totalExtras ) }` ],
	];
	for ( const [ a, b ] of filasPrecio ) {

		texto( a, M, y + 5, 9.5, a.startsWith( 'Total' ) ? TINTA : GRIS, a.startsWith( 'Total' ) ? 'bold' : 'normal' );
		texto( b, A4.ancho - M, y + 5, 9.5, TINTA, a.startsWith( 'Total' ) ? 'bold' : 'normal', { align: 'right' } );
		y += 7;
		linea( M, y, A4.ancho - M, y );

	}

	y += 3;
	doc.setFillColor( suave[ 0 ], suave[ 1 ], suave[ 2 ] );
	doc.roundedRect( M, y, anchoUtil, 14, 2, 2, 'F' );
	texto( 'Precio total', M + 5, y + 9, 12, TINTA, 'bold' );
	texto( fmtEuros( conf.total ), A4.ancho - M - 5, y + 9.3, 16, acento, 'bold', { align: 'right' } );
	y += 19;
	const aviso = partir( marca.legal.precios, anchoUtil, 7.5 );
	texto( aviso, M, y + 2, 7.5, GRIS_CLARO );
	y += aviso.length * 3.3 + 8;

	// conformidad del comprador: en su propia página si no cabe entera
	if ( y > 175 ) {

		doc.addPage();
		cabecera();
		y = 38;

	}

	texto( 'Conformidad del comprador', M, y, 13, TINTA, 'bold' );
	y += 4;
	doc.setFillColor( acento[ 0 ], acento[ 1 ], acento[ 2 ] );
	doc.roundedRect( M, y, anchoUtil, 11, 2, 2, 'F' );
	texto( 'Descarga este documento, fírmalo y envíalo a tu comercial para confirmar tu selección.', M + 5, y + 7, 9.5, [ 255, 255, 255 ], 'bold' );
	y += 18;

	const campo = ( etiqueta: string, x: number, ancho: number ) => {

		texto( etiqueta.toUpperCase(), x, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
		linea( x, y + 9, x + ancho, y + 9, GRIS, 0.3 );

	};

	campo( 'Nombre y apellidos', M, anchoUtil );
	y += 16;
	campo( 'DNI / NIE', M, anchoUtil * 0.48 );
	campo( 'Fecha', M + anchoUtil * 0.52, anchoUtil * 0.48 );
	y += 16;
	texto( 'FIRMA', M, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
	doc.setDrawColor( GRIS[ 0 ], GRIS[ 1 ], GRIS[ 2 ] );
	doc.setLineWidth( 0.3 );
	doc.roundedRect( M, y + 2.5, anchoUtil * 0.48, 28, 1.5, 1.5, 'S' );
	texto( 'OBSERVACIONES', M + anchoUtil * 0.52, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
	doc.roundedRect( M + anchoUtil * 0.52, y + 2.5, anchoUtil * 0.48, 28, 1.5, 1.5, 'S' );
	y += 38;

	const com = marca.comercial;
	if ( com ) {

		texto( `Tu comercial: ${ com.nombre } · ${ com.telefono } · ${ com.email }`, M, y, 8.5, GRIS );

	}

	// ---------------------------------------------------------------- pie en todas las páginas
	const paginas = doc.getNumberOfPages();
	for ( let i = 1; i <= paginas; i ++ ) {

		doc.setPage( i );
		linea( M, A4.alto - 20, A4.ancho - M, A4.alto - 20 );
		texto( marca.legal.pie, M, A4.alto - 15.5, 6.8, GRIS_CLARO );
		texto( `${ marca.contacto.web } · ${ marca.contacto.telefono } · ${ marca.contacto.email }`, M, A4.alto - 12, 6.8, GRIS_CLARO );
		texto( `Generado el ${ fecha } a las ${ hora } · Página ${ i } de ${ paginas }`, A4.ancho - M, A4.alto - 12, 6.8, GRIS_CLARO, 'normal', { align: 'right' } );

	}

	doc.setProperties( { title: `Documento de selección · ${ p.promocion.nombre } · ${ v.ref }`, author: marca.promotora, creator: marca.promotora } );
	return doc.output( 'blob' );

}
