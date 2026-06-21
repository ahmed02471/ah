/**
 * توليد رقم اللوحة — سبها
 * التنسيق: 5 - XXXXXX [عن] (لسيارات النقل)
 * رقم 5 = رمز منطقة سبها
 * XXXXXX = 7 أرقام عشوائية
 */

function generatePlateNumber(vehicleType) {
  const regionCode = '5'; // سبها
  // توليد 7 أرقام عشوائية
  const random = Math.floor(1000000 + Math.random() * 9000000).toString();
  
  let plate = `${regionCode}/${random}`;
  
  // سيارات النقل تحمل إضافة "ع ن"
  const transportTypes = ['سيارة نقل بضائع', 'سيارة جرارة', 'مركبة مقطورة', 'نقل'];
  if (transportTypes.some(t => vehicleType && vehicleType.includes(t.split(' ')[0]))) {
    plate += ' ع ن';
  }
  
  return plate;
}

// التحقق من صحة الرقم الوطني الليبي
function validateNationalId(nationalId) {
  if (!nationalId) return { valid: false, msg: 'الرقم الوطني مطلوب' };
  const id = nationalId.toString().trim();
  if (!/^\d{12}$/.test(id))
    return { valid: false, msg: 'الرقم الوطني يجب أن يتكون من 12 رقماً فقط بدون حروف أو رموز' };
  if (!['1','2'].includes(id[0]))
    return { valid: false, msg: 'يجب أن يبدأ الرقم الوطني بـ 1 (ذكر) أو 2 (أنثى)' };
  if (/^(\d)\1{11}$/.test(id))
    return { valid: false, msg: 'الرقم الوطني غير صالح — لا يجوز أن تكون جميع الأرقام متكررة' };
  // منع التسلسلات الواضحة
  const seq = ['123456789012','210987654321','012345678901'];
  if (seq.includes(id))
    return { valid: false, msg: 'الرقم الوطني غير صالح' };
  return { valid: true, gender: id[0] === '1' ? 'ذكر' : 'أنثى' };
}

module.exports = { generatePlateNumber, validateNationalId };
