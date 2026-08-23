import { parseReportContent } from './adapters/report.js';

// 真实格式（来自 000043 2026Q2 季报正文，debug2 抓取）：列间用空格填充，行尾无 % 号
const TEXT = `
国家（地区）证券市场的股票及存托凭证投资分布

  国家（地区）          公允价值（人民币元）          占基金资产净值比例（%）

美国                                4,837,979,682.13                        94.94

合计                                4,837,979,682.13                        94.94

5.3 报告期末按行业分类的股票及存托凭证投资组合

          行业类别                    公允价值（人民币元）        占基金资产净值
                                                                    比例(%)

通信服务                                            557,898,457.12            10.95

非必需消费品                                        375,112,955.17            7.36

必需消费品                                          113,392,880.93            2.23

能源                                                49,851,058.30            0.98

金融                                                134,684,065.69            2.64

医疗保健                                            300,444,363.34            5.90

工业                                                449,871,805.29            8.83

信息技术                                          2,776,227,705.36            54.48

原材料                                              52,975,652.27            1.04

房地产                                              120,000,000.00            2.35

公用事业                                             30,000,000.00            0.59

5.4 报告期末按公允价值占基金资产净值比例大小排序的前十名股票及存托凭证投资明细

 1  Apple Inc  苹果公司  AAPL UW  纳斯达克  美国  214,321  422,384,260.59        8.29
`;

// 同一份数据，但用 HTML <table> 呈现（验证 htmlToText 兜底）
const HTML = `
<table>
<tr><td>国家（地区）证券市场的股票及存托凭证投资分布</td></tr>
<tr><td>国家（地区）</td><td>公允价值（人民币元）</td><td>占基金资产净值比例（%）</td></tr>
<tr><td>美国</td><td>4,837,979,682.13</td><td>94.94</td></tr>
<tr><td>合计</td><td>4,837,979,682.13</td><td>94.94</td></tr>
<tr><td>报告期末按行业分类的股票及存托凭证投资组合</td></tr>
<tr><td>行业类别</td><td>公允价值（人民币元）</td><td>占基金资产净值比例(%)</td></tr>
<tr><td>通信服务</td><td>557,898,457.12</td><td>10.95</td></tr>
<tr><td>信息技术</td><td>2,776,227,705.36</td><td>54.48</td></tr>
<tr><td>房地产</td><td>120,000,000.00</td><td>2.35</td></tr>
</table>
`;

// 联接/ feeder 基金：明确不持有股票及存托凭证
const FEEDER = `
报告期末按行业分类的股票及存托凭证投资组合

  本基金本报告期末未持有股票及存托凭证。

国家（地区）证券市场的股票及存托凭证投资分布

  本基金本报告期末未持有股票及存托凭证。
`;

function assert(name, cond, extra='') { console.log((cond?'PASS':'FAIL')+' '+name+(extra?'  '+extra:'')); }

const t = parseReportContent(TEXT);
assert('TEXT region=1', t.region.length===1, JSON.stringify(t.region));
assert('TEXT region 美国 0.9494', t.region[0]?.name==='美国' && Math.abs(t.region[0].pct-0.9494)<1e-6);
assert('TEXT industry=11', t.industry.length===11, 'got '+t.industry.length);
assert('TEXT industry 信息技术 0.5448', t.industry.some(r=>r.name==='信息技术'&&Math.abs(r.pct-0.5448)<1e-6));
assert('TEXT no 合计 leak', !t.industry.some(r=>r.name==='合计') && !t.region.some(r=>r.name==='合计'));

const h = parseReportContent(HTML);
assert('HTML region=1', h.region.length===1, JSON.stringify(h.region));
assert('HTML region 美国 0.9494', h.region[0]?.name==='美国' && Math.abs(h.region[0].pct-0.9494)<1e-6);
assert('HTML industry=3', h.industry.length===3, 'got '+h.industry.length);

const f = parseReportContent(FEEDER);
assert('FEEDER region=0', f.region.length===0);
assert('FEEDER industry=0', f.industry.length===0);

process.exit(0);
