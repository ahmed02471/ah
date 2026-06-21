/**
 * libya-cities.js — قوائم المدن والأحياء الليبية
 * نظام إدارة مرور سبها
 */

const LIBYA_CITIES = {
  'سبها': [
    'حي الجديد',
    'حي القرضة',
    'حي حجارة',
    'المنشية',
    'المهدية',
    'سكرة',
    'حي عبد الكافي',
    'حي لقراد',
    'الناصرية',
    'قُعيد',
    'الثانوية',
    'غيره',
  ],
  'براك الشاطئ': [
    'وسط المدينة',
    'حي الشاطئ',
    'حي الوادي',
    'حي الجديد',
    'غيره',
  ],
  'مرزق': [
    'وسط المدينة',
    'حي الجديد',
    'حي التقدم',
    'منطقة الفزان',
    'غيره',
  ],
  'أوباري': [
    'وسط المدينة',
    'حي المركز',
    'حي الجديد',
    'غيره',
  ],
  'القطرون': [
    'وسط المدينة',
    'حي المركز',
    'غيره',
  ],
  'تراغن': [
    'وسط المدينة',
    'غيره',
  ],
  'الجفرة': [
    'هون',
    'سوكنة',
    'ودان',
    'غيره',
  ],
  'مصراتة': [
    'وسط المدينة','الميناء','المنشية','الغيران','السوق','حي الصناعية','غيره',
  ],
  'طرابلس': [
    'المدينة القديمة','حي الأندلس','سوق الجمعة','طريق الميتكة','عين زارة',
    'الفرناج','سيدي خريبيش','العزيزية','غيره',
  ],
  'بنغازي': [
    'وسط المدينة','حي الصابري','السلماني','الكويفية','الهواري','الجليانة','غيره',
  ],
  'الزاوية': ['وسط المدينة','حي الجديد','غيره'],
  'الخمس':  ['وسط المدينة','حي الساحل','غيره'],
  'ترهونة': ['وسط المدينة','غيره'],
  'زليتن':  ['وسط المدينة','غيره'],
  'سرت':    ['وسط المدينة','غيره'],
  'درنة':   ['وسط المدينة','غيره'],
  'البيضاء':['وسط المدينة','غيره'],
  'أجدابيا':['وسط المدينة','غيره'],
  'غريان':  ['وسط المدينة','غيره'],
  'أخرى':   ['غيره'],
};

/**
 * يملأ قائمة المدن في عنصر select
 * @param {string} citySelectId - id عنصر المدينة
 * @param {string} districtSelectId - id عنصر الحي
 * @param {string} defaultCity - المدينة المختارة افتراضياً
 */
function initCityDistrict(citySelectId, districtSelectId, defaultCity='') {
  const cityEl = document.getElementById(citySelectId);
  const distEl = document.getElementById(districtSelectId);
  if (!cityEl || !distEl) return;

  // تعبئة المدن
  cityEl.innerHTML = '<option value="">— اختر المدينة —</option>' +
    Object.keys(LIBYA_CITIES).map(c =>
      `<option value="${c}" ${c===defaultCity?'selected':''}>${c}</option>`
    ).join('');

  // تعبئة الأحياء عند اختيار مدينة
  function updateDistricts(city, defaultDistrict='') {
    const districts = LIBYA_CITIES[city] || ['غيره'];
    distEl.innerHTML = '<option value="">— اختر الحي —</option>' +
      districts.map(d =>
        `<option value="${d}" ${d===defaultDistrict?'selected':''}>${d}</option>`
      ).join('');
    distEl.disabled = !city;
  }

  cityEl.addEventListener('change', () => updateDistricts(cityEl.value));

  if (defaultCity) updateDistricts(defaultCity);
  else distEl.disabled = true;
}

/**
 * يُعيد قيمة العنوان الكاملة مجمّعة
 */
function getAddress(citySelectId, districtSelectId, detailsId) {
  const city     = document.getElementById(citySelectId)?.value  || '';
  const district = document.getElementById(districtSelectId)?.value || '';
  const details  = document.getElementById(detailsId)?.value.trim() || '';
  const parts = [city, district, details].filter(Boolean);
  return parts.join(' — ');
}

/**
 * يُحلل العنوان المخزون ويُعيد أجزاءه
 */
function parseAddress(address) {
  if (!address) return { city:'', district:'', details:'' };
  const parts = address.split(' — ');
  return {
    city:     parts[0] || '',
    district: parts[1] || '',
    details:  parts[2] || ''
  };
}
