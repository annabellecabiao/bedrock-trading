const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

function formatSku(id, category) {
  if (!id) return '';
  const str = String(id).trim();
  if (str.toUpperCase().startsWith('BR-')) return str.toUpperCase();
  const match = str.match(/^([a-zA-Z]+)(\d+)$/);
  if (match) {
    const catCode = match[1].toUpperCase();
    return `BR-${catCode}${match[2]}`;
  }
  const catCode = (category === 'oil' || category === 'olive oil') ? 'O' : 'W';
  return `BR-${catCode}-${str.toUpperCase()}`;
}

// ============================================================================
// 1. SALES REPORT (ADMIN ONLY)
// ============================================================================
router.get('/sales', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (start_date) {
      query += ' AND date(created_at) >= date(?)';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND date(created_at) <= date(?)';
      params.push(end_date);
    }
    query += ' ORDER BY created_at DESC';
    const orders = db.prepare(query).all(...params);

    let totalGrossRevenue = 0;
    let totalNetProductSales = 0;
    let totalDeliveryFees = 0;
    let totalUnitsSold = 0;
    let deliveredOrdersCount = 0;
    let pendingOrdersCount = 0;

    const categorySales = {
      wine: { revenue: 0, units_sold: 0, orders: 0 },
      oil: { revenue: 0, units_sold: 0, orders: 0 }
    };

    const subCategorySales = {
      Red: { revenue: 0, units_sold: 0 },
      White: { revenue: 0, units_sold: 0 },
      Sparkling: { revenue: 0, units_sold: 0 },
      Rose: { revenue: 0, units_sold: 0 },
      Picual: { revenue: 0, units_sold: 0 },
      Arbequina: { revenue: 0, units_sold: 0 },
      Coupage: { revenue: 0, units_sold: 0 }
    };

    const productSalesMap = {};
    const paymentMethods = {};
    const deliveryMethods = {};
    const dailySales = {};

    orders.forEach(o => {
      const orderAmount = Number(o.total_amount) || 0;
      const fee = Number(o.delivery_fee) || 0;
      const netProducts = orderAmount - fee;
      const isDeliveredOrActive = o.status !== 'cancelled';

      if (isDeliveredOrActive) {
        totalGrossRevenue += orderAmount;
        totalNetProductSales += netProducts;
        totalDeliveryFees += fee;
        totalUnitsSold += (Number(o.total_items) || 0);

        if (o.status === 'delivered') deliveredOrdersCount++;
        if (o.status === 'pending') pendingOrdersCount++;

        // Payment Methods
        const pm = (o.payment_method || 'other').toUpperCase();
        paymentMethods[pm] = (paymentMethods[pm] || 0) + orderAmount;

        // Delivery Methods
        const dm = o.delivery_method || 'Standard';
        deliveryMethods[dm] = (deliveryMethods[dm] || 0) + 1;

        // Daily Trend
        const day = (o.created_at || '').substring(0, 10) || 'Recent';
        dailySales[day] = (dailySales[day] || 0) + orderAmount;

        // Parse items
        let items = [];
        try {
          items = JSON.parse(o.items || '[]');
        } catch (e) {
          items = [];
        }

        let hasWine = false;
        let hasOil = false;

        items.forEach(it => {
          const qty = Number(it.qty) || 1;
          const price = Number(it.price) || 0;
          const lineTotal = price * qty;
          const cat = (it.category || (String(it.id).startsWith('w') ? 'wine' : 'oil')).toLowerCase();
          const sub = it.type || (cat === 'wine' ? 'Red' : 'Coupage');

          if (cat === 'wine') {
            hasWine = true;
            categorySales.wine.revenue += lineTotal;
            categorySales.wine.units_sold += qty;
          } else {
            hasOil = true;
            categorySales.oil.revenue += lineTotal;
            categorySales.oil.units_sold += qty;
          }

          if (subCategorySales[sub]) {
            subCategorySales[sub].revenue += lineTotal;
            subCategorySales[sub].units_sold += qty;
          } else {
            subCategorySales.Coupage.revenue += lineTotal;
            subCategorySales.Coupage.units_sold += qty;
          }

          // Product level tracking
          const pid = it.id || it.name;
          if (!productSalesMap[pid]) {
            productSalesMap[pid] = {
              id: it.id,
              name: it.name,
              category: cat,
              subCategory: sub,
              unitsSold: 0,
              totalRevenue: 0
            };
          }
          productSalesMap[pid].unitsSold += qty;
          productSalesMap[pid].totalRevenue += lineTotal;
        });

        if (hasWine) categorySales.wine.orders++;
        if (hasOil) categorySales.oil.orders++;
      }
    });

    const activeOrdersCount = orders.filter(o => o.status !== 'cancelled').length;
    const aov = activeOrdersCount > 0 ? Math.round(totalGrossRevenue / activeOrdersCount) : 0;

    const topSellingProducts = Object.values(productSalesMap)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    const detailedOrders = orders.map(o => ({
      ...o,
      items: JSON.parse(o.items || '[]')
    }));

    const topProductsFormatted = topSellingProducts.map(p => ({
      id: p.id,
      sku: formatSku(p.id, p.category),
      name: p.name,
      category: p.category,
      sub_category: p.subCategory,
      units_sold: p.unitsSold,
      revenue: p.totalRevenue
    }));

    const ledgerFormatted = detailedOrders.map(o => ({
      order_number: o.order_number,
      date: o.created_at,
      customer: o.customer_name,
      items: o.items,
      payment_method: o.payment_method,
      status: o.status,
      total: o.total_amount
    }));

    res.json({
      reportTitle: 'Sales Performance & Revenue Report',
      generatedAt: new Date().toISOString(),
      generatedBy: req.user.full_name || req.user.username,
      kpis: {
        gross_revenue: totalGrossRevenue,
        net_product_sales: totalNetProductSales,
        total_orders: orders.length,
        active_orders: activeOrdersCount,
        delivered_orders: deliveredOrdersCount,
        pending_orders: pendingOrdersCount,
        total_units_sold: totalUnitsSold,
        aov: aov
      },
      by_category: categorySales,
      by_sub_category: subCategorySales,
      top_products: topProductsFormatted,
      ledger: ledgerFormatted,
      // Legacy fields
      summary: {
        totalOrders: orders.length,
        activeOrders: activeOrdersCount,
        deliveredOrders: deliveredOrdersCount,
        pendingOrders: pendingOrdersCount,
        totalGrossRevenue,
        totalNetProductSales,
        totalDeliveryFees,
        totalUnitsSold,
        averageOrderValue: aov
      },
      categoryBreakdown: categorySales,
      subCategoryBreakdown: subCategorySales,
      topSellingProducts,
      paymentMethods,
      deliveryMethods,
      dailyTrend: dailySales,
      ordersList: detailedOrders
    });
  } catch (err) {
    console.error('Sales report error:', err);
    res.status(500).json({ error: 'Failed to generate sales report: ' + err.message });
  }
});

// ============================================================================
// 2. FINANCIAL REPORT (ADMIN ONLY)
// ============================================================================
router.get('/financial', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let query = "SELECT * FROM orders WHERE status != 'cancelled'";
    const params = [];
    if (start_date) {
      query += ' AND date(created_at) >= date(?)';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND date(created_at) <= date(?)';
      params.push(end_date);
    }
    query += ' ORDER BY created_at DESC';
    const orders = db.prepare(query).all(...params);

    let grossRevenue = 0;
    let deliveryFeesCollected = 0;
    let netProductRevenue = 0;

    orders.forEach(o => {
      const amt = Number(o.total_amount) || 0;
      const fee = Number(o.delivery_fee) || 0;
      grossRevenue += amt;
      deliveryFeesCollected += fee;
      netProductRevenue += (amt - fee);
    });

    // Cost of Goods Sold (approx. 56% of net product sales)
    const estimatedCOGS = netProductRevenue * 0.56;
    const grossProfit = netProductRevenue - estimatedCOGS;
    const grossMarginPct = netProductRevenue > 0 ? (grossProfit / netProductRevenue) * 100 : 0;

    // Standard 12% PH VAT component
    const estimatedVat = netProductRevenue * (12 / 112);

    // Logistics fulfillment estimate (courier costs vs fee collected)
    const estimatedLogisticsCost = deliveryFeesCollected * 0.85;
    const logisticsNetContribution = deliveryFeesCollected - estimatedLogisticsCost;

    // Digital Payment gateway fees (approx 1.8% of gross electronic payments)
    const paymentProcessingFees = grossRevenue * 0.018;

    // Net operating contribution
    const netOperatingContribution = grossProfit + logisticsNetContribution - paymentProcessingFees;
    const netMarginPct = grossRevenue > 0 ? (netOperatingContribution / grossRevenue) * 100 : 0;

    // Payment collection breakdown
    const paymentCollections = {};
    const paymentChannels = {};
    orders.forEach(o => {
      const p = (o.payment_method || 'other').toUpperCase();
      const amt = Number(o.total_amount || 0);
      paymentCollections[p] = (paymentCollections[p] || 0) + amt;
      if (!paymentChannels[p]) {
        paymentChannels[p] = { count: 0, total: 0 };
      }
      paymentChannels[p].count++;
      paymentChannels[p].total += amt;
    });

    // Status breakdown
    const orderStatusFinancials = {};
    orders.forEach(o => {
      const st = o.status;
      if (!orderStatusFinancials[st]) {
        orderStatusFinancials[st] = { count: 0, total: 0, amount: 0 };
      }
      orderStatusFinancials[st].count++;
      orderStatusFinancials[st].total += Number(o.total_amount || 0);
      orderStatusFinancials[st].amount += Number(o.total_amount || 0);
    });

    res.json({
      reportTitle: 'Financial Audit & Margin Statement',
      fiscalPeriod: `Fiscal Year ${new Date().getFullYear()}`,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user.full_name || req.user.username,
      summary: {
        gross_revenue: grossRevenue,
        estimated_cogs: Number(estimatedCOGS.toFixed(2)),
        estimated_gross_margin: Number(grossProfit.toFixed(2)),
        gross_margin_percentage: Number(grossMarginPct.toFixed(2)),
        estimated_vat_12_pct: Number(estimatedVat.toFixed(2)),
        delivery_fees_collected: Number(deliveryFeesCollected.toFixed(2)),
        payment_processing_fees: Number(paymentProcessingFees.toFixed(2)),
        net_operating_contribution: Number(netOperatingContribution.toFixed(2)),
        net_margin_percentage: Number(netMarginPct.toFixed(2))
      },
      payment_channels: paymentChannels,
      status_breakdown: orderStatusFinancials,
      // Legacy fields
      statement: {
        grossRevenue,
        netProductRevenue,
        deliveryFeesCollected,
        estimatedCOGS,
        grossProfit,
        grossMarginPct: Number(grossMarginPct.toFixed(2)),
        estimatedVat: Number(estimatedVat.toFixed(2)),
        logisticsNetContribution: Number(logisticsNetContribution.toFixed(2)),
        paymentProcessingFees: Number(paymentProcessingFees.toFixed(2)),
        netOperatingContribution: Number(netOperatingContribution.toFixed(2)),
        netMarginPct: Number(netMarginPct.toFixed(2))
      },
      paymentCollections,
      orderStatusFinancials,
      transactionCount: orders.length
    });
  } catch (err) {
    console.error('Financial report error:', err);
    res.status(500).json({ error: 'Failed to generate financial report: ' + err.message });
  }
});

// ============================================================================
// 3. INVENTORY REPORT (ACCESSIBLE TO BOTH USERS: ADMIN & VIEWER)
// ============================================================================
router.get('/inventory', authenticate, (req, res) => {
  try {
    const products = db.prepare(`
      SELECT
        id, category, name, fullName, variety, region, denomination, type,
        volume, container, special, price, in_stock, stock_quantity, reorder_level,
        updated_at
      FROM products
      ORDER BY
        CASE WHEN category = 'wine' THEN 1 ELSE 2 END,
        type ASC,
        id ASC
    `).all();

    let totalCatalogSKUs = products.length;
    let totalStockUnits = 0;
    let totalStockValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let inStockCount = 0;

    const categorySummary = {
      wine: { skus: 0, units: 0, valuation: 0 },
      oil: { skus: 0, units: 0, valuation: 0 }
    };

    const subCategorySummary = {
      wine: {
        Red: { skus: 0, units: 0, valuation: 0 },
        White: { skus: 0, units: 0, valuation: 0 },
        Sparkling: { skus: 0, units: 0, valuation: 0 },
        Rose: { skus: 0, units: 0, valuation: 0 }
      },
      oil: {
        Picual: { skus: 0, units: 0, valuation: 0 },
        Arbequina: { skus: 0, units: 0, valuation: 0 },
        Coupage: { skus: 0, units: 0, valuation: 0 }
      }
    };

    const inventoryList = products.map(p => {
      const qty = Number(p.stock_quantity) || 0;
      const unitPrice = Number(p.price) || 0;
      const totalVal = qty * unitPrice;
      const reorderLvl = Number(p.reorder_level) || 15;
      const isAvailable = p.in_stock === 1 && qty > 0;

      let status = 'In Stock';
      if (!isAvailable || qty === 0) {
        status = 'Out of Stock';
        outOfStockCount++;
      } else if (qty <= reorderLvl) {
        status = 'Low Stock';
        lowStockCount++;
        inStockCount++;
      } else {
        inStockCount++;
      }

      totalStockUnits += qty;
      totalStockValuation += totalVal;

      const cat = p.category === 'wine' ? 'wine' : 'oil';
      categorySummary[cat].skus++;
      categorySummary[cat].units += qty;
      categorySummary[cat].valuation += totalVal;

      const sub = p.type || (cat === 'wine' ? 'Red' : 'Coupage');
      if (subCategorySummary[cat] && subCategorySummary[cat][sub]) {
        subCategorySummary[cat][sub].skus++;
        subCategorySummary[cat][sub].units += qty;
        subCategorySummary[cat][sub].valuation += totalVal;
      }

      return {
        id: p.id,
        sku: formatSku(p.id, p.category),
        name: p.name,
        fullName: p.fullName || p.name,
        category: p.category === 'wine' ? 'wine' : 'oil',
        subCategory: p.type || '—',
        variety: p.variety || '—',
        volume: p.volume || p.region || 'Spain',
        regionOrVolume: p.region || p.volume || '—',
        container: p.container || 'Bottle',
        price: unitPrice,
        unitPrice,
        stock_quantity: qty,
        stockLevel: qty,
        reorder_level: reorderLvl,
        reorderLevel: reorderLvl,
        in_stock: p.in_stock === 1 ? 1 : 0,
        inStockFlag: p.in_stock === 1,
        status,
        valuation: totalVal,
        stockValuation: totalVal,
        lastUpdated: p.updated_at
      };
    });

    const bySubCategory = {
      Red: {
        count: subCategorySummary.wine.Red.skus,
        stock: subCategorySummary.wine.Red.units,
        valuation: subCategorySummary.wine.Red.valuation
      },
      White: {
        count: subCategorySummary.wine.White.skus,
        stock: subCategorySummary.wine.White.units,
        valuation: subCategorySummary.wine.White.valuation
      },
      Sparkling: {
        count: subCategorySummary.wine.Sparkling.skus,
        stock: subCategorySummary.wine.Sparkling.units,
        valuation: subCategorySummary.wine.Sparkling.valuation
      },
      Rose: {
        count: subCategorySummary.wine.Rose.skus,
        stock: subCategorySummary.wine.Rose.units,
        valuation: subCategorySummary.wine.Rose.valuation
      },
      Picual: {
        count: subCategorySummary.oil.Picual.skus,
        stock: subCategorySummary.oil.Picual.units,
        valuation: subCategorySummary.oil.Picual.valuation
      },
      Arbequina: {
        count: subCategorySummary.oil.Arbequina.skus,
        stock: subCategorySummary.oil.Arbequina.units,
        valuation: subCategorySummary.oil.Arbequina.valuation
      },
      Coupage: {
        count: subCategorySummary.oil.Coupage.skus,
        stock: subCategorySummary.oil.Coupage.units,
        valuation: subCategorySummary.oil.Coupage.valuation
      }
    };

    res.json({
      reportTitle: 'Inventory Stock Level & Valuation Report',
      accessibleBy: 'Both Users (Admin & Viewer)',
      generatedAt: new Date().toISOString(),
      viewerUser: {
        username: req.user.username,
        role: req.user.role,
        fullName: req.user.full_name
      },
      kpis: {
        total_skus: totalCatalogSKUs,
        wine_skus: categorySummary.wine.skus,
        oil_skus: categorySummary.oil.skus,
        total_stock_units: totalStockUnits,
        low_stock_skus: lowStockCount,
        out_of_stock_skus: outOfStockCount,
        in_stock_skus: inStockCount,
        total_valuation: totalStockValuation
      },
      by_sub_category: bySubCategory,
      inventory: inventoryList,
      // Legacy fields
      metrics: {
        totalCatalogSKUs,
        totalStockUnits,
        totalStockValuation,
        inStockCount,
        lowStockCount,
        outOfStockCount
      },
      categorySummary,
      subCategorySummary
    });
  } catch (err) {
    console.error('Inventory report error:', err);
    res.status(500).json({ error: 'Failed to generate inventory report: ' + err.message });
  }
});

module.exports = router;
