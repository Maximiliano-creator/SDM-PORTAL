/**
 * Convierte el input externo del ERP en la shape interna que BLS
 * espera en `POST/PUT /api/shopGoodsInfo`. Aplica defaults razonables
 * para campos faltantes en upsert por PLU.
 */
export function toShopGoodsBase(it, shopCode, shopId) {
    return {
        shopCode: it.shop_code ?? shopCode,
        shopId,
        goodsPlu: it.plu,
        itemCode: it.plu,
        goodsName: it.name ?? it.plu,
        unitName: it.unit ?? 'KG',
        priceModel: (it.price_model ?? 0),
        price: it.price ?? 0,
        memberPrice: it.member_price ?? null,
        promotionPrice: it.promotion_price ?? null,
        barCode: it.barcode ?? '',
        barCodeType: it.barcode_type ?? '',
        deptCode: it.dept_code ?? '',
        brand: it.brand ?? '',
        spec: it.spec ?? '',
        origin: it.origin ?? '',
        qualityPeriod: it.quality_period_days ?? null,
        priceVariable: '0',
        labelNo: 0,
        downTermEnabled: 1,
    };
}
export function csvHeaderToErpKey(header) {
    const norm = header.trim().toLowerCase().replace(/\s+/g, '_');
    const map = {
        plu: 'plu',
        code: 'plu',
        sku: 'plu',
        name: 'name',
        nombre: 'name',
        descripcion: 'name',
        descripción: 'name',
        description: 'name',
        price: 'price',
        precio: 'price',
        member_price: 'member_price',
        precio_socio: 'member_price',
        promotion_price: 'promotion_price',
        precio_promo: 'promotion_price',
        promo_price: 'promotion_price',
        unit: 'unit',
        unidad: 'unit',
        price_model: 'price_model',
        modo_precio: 'price_model',
        dept_code: 'dept_code',
        departamento: 'dept_code',
        barcode: 'barcode',
        codigo_barras: 'barcode',
        'código_barras': 'barcode',
        ean: 'barcode',
        barcode_type: 'barcode_type',
        brand: 'brand',
        marca: 'brand',
        spec: 'spec',
        especificacion: 'spec',
        'especificación': 'spec',
        origin: 'origin',
        origen: 'origin',
        quality_period_days: 'quality_period_days',
        vida_util: 'quality_period_days',
        shop_code: 'shop_code',
        tienda: 'shop_code',
    };
    return map[norm] ?? null;
}
//# sourceMappingURL=mapErp.js.map