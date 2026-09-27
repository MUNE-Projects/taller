// Formato de datos de una vivienda. Todo en metros, en planta:
// x hacia el este, y hacia el norte. Cada dato lleva su `origen`
// (plano | usuario | memoria | supuesto) para saber qué es fiable.

export type Rect = [ number, number, number, number ]; // xmin, ymin, xmax, ymax
export type Punto = [ number, number ];
export type Orientacion = 'n' | 's' | 'e' | 'o';

export interface Valor<T> {
	valor: T;
	origen: string;
}

export interface Muro {
	id: string;
	tipo: 'envolvente' | 'tabique' | 'pilar';
	rect: Rect;
	origen: string;
}

export interface Hueco {
	id: string;
	muro: string;
	tipo: 'entrada' | 'puerta' | 'balconera';
	eje: 'x' | 'y';
	desde: number;
	hasta: number;
	bisagra?: 'inicio' | 'fin';
	abre?: Orientacion;
	apertura?: 'corredera' | 'oscilobatiente';
	hojas?: number;
	origen: string;
}

export type Uso = 'dia' | 'noche' | 'humedo' | 'servicio' | 'circulacion' | 'exterior';

export interface Estancia {
	id: string;
	nombre: string;
	superficie: number;
	uso: Uso;
	suelo: string;
	poligono: Punto[];
	origen: string;
}

export interface Equipamiento {
	id: string;
	tipo: string;
	rect: Rect;
	frente: Orientacion;
	fijo: boolean;
	origen: string;
	placa?: [ number, number ];
	fregadero?: [ number, number ];
	lavavajillas?: [ number, number ];
}

export interface Vivienda {
	meta: {
		nombre: string;
		fuente: string;
		superficies_oficiales: { interior: number; exterior: number; construida: number };
	};
	alturas: {
		libre: Valor<number>;
		forjado: Valor<number>;
		puerta_interior: Valor<number>;
		puerta_entrada: Valor<number>;
		balconera: Valor<number>;
		barandilla: Valor<number>;
	};
	muros: Muro[];
	huecos: Hueco[];
	estancias: Estancia[];
	equipamiento: Equipamiento[];
	exterior: {
		barandilla: { recorrido: Punto[]; postes_x: number[] };
	};
}

// ------------------------------------------------------------ configurador

/** Parche de distribución: solo describe lo que cambia respecto a la vivienda base. */
export interface Variante {
	id: string;
	nombre: string;
	descripcion: string;
	/** Frase corta para el aviso al comprador. */
	resumen: string;
	/** Vista que explica el efecto espacial de la variante. */
	vista: { nombre: string; pos: [ number, number, number ]; obj: [ number, number, number ]; fov: number; interior?: boolean } | null;
	origen: string;
	muros: { quitar: string[]; anadir: Muro[]; modificar: Record<string, Partial<Muro>> };
	huecos: { quitar: string[]; anadir: Hueco[]; modificar: Record<string, Partial<Hueco>> };
	estancias: { modificar: Record<string, Partial<Estancia>> };
	equipamiento: { quitar: string[]; anadir: Equipamiento[]; modificar: Record<string, Partial<Equipamiento>> };
}

export interface Opcion {
	id: string;
	nombre: string;
	detalle?: string;
	precio: number;
	variante?: string | null;
	piscina?: boolean;
	parametros?: Record<string, string | number>;
}

export interface Categoria {
	id: string;
	nombre: string;
	detalle?: string;
	/** Vista maestra a la que llevar al cambiar la opción, o "mantener". */
	vista: string;
	/** Solo lleva a la vista al activar una mejora, no al volver a la opción incluida. */
	soloAlActivar?: boolean;
	opciones: Opcion[];
}

export interface Configuracion {
	moneda: string;
	categorias: Categoria[];
}

export interface Piscina {
	rect: Rect; alturaVaso: number; alturaAgua: number; espesor: number; albardilla: number; pasoMinimoFachada: number;
}

// ------------------------------------------------------------ promoción

export interface Vista {
	nombre: string;
	pos: [ number, number, number ];
	obj: [ number, number, number ];
	fov: number;
	interior?: boolean;
}

/** Tipología: geometría, cámaras maestras y extras que dependen de la geometría. */
export interface Tipologia {
	id: string;
	nombre: string;
	resumen: string;
	dormitorios: number;
	banos: number;
	vistas: Record<string, Vista>;
	guiadas: string[];
	piscina: Piscina;
}

export interface ViviendaPromocion {
	ref: string;
	portal?: string;
	planta: string;
	tipologia: string;
	/** Vivienda simétrica de su tipología (se espeja la geometría al cargar). */
	espejo: boolean;
	orientacion: string;
	precioBase: number;
	superficies: { util: number; exterior: number; construida: number };
	/** Restricciones de opciones para esta vivienda (por categoría). */
	opciones?: Record<string, string[]>;
	nota?: string;
	/** SHA-256 de "<id promoción>:<código de acceso>". */
	acceso: string;
}

export interface Marca {
	promotora: string;
	logoSvg: string;
	colorPrincipal: string;
	colorSecundario: string;
	tipografia: { familia: string; googleFonts?: string };
	favicon: string | null;
	contacto: { telefono: string; email: string; web: string; direccion: string };
	comercial?: { nombre: string; telefono: string; email: string };
	legal: { precios: string; imagenes: string; pie: string };
}

export interface Promocion {
	id: string;
	urlBase: string;
	marca: Marca;
	promocion: { nombre: string; ubicacion: string };
	tipologias: { id: string; opciones: Record<string, string[]> }[];
	viviendas: ViviendaPromocion[];
	/** Acceso al Studio de producción (hash del código). */
	studio?: { acceso: string };
}
