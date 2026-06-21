const express = require('express');
const router  = express.Router();
const v       = require('../controllers/vehicleController');
const { authenticate, authorize } = require('../middleware/auth');
const upload  = require('../middleware/upload');

// قائمة + تفاصيل
router.get ('/',              authenticate, v.list);
router.get ('/types',         authenticate, v.getVehicleTypes);
router.get ('/pending',       authenticate, v.listPending);
router.get ('/pending/:id',   authenticate, v.getPendingById);
router.get ('/qr/:token',     authenticate, v.getByQr);
router.get ('/by-token/:token', v.getByQr); // كاميرا Hikvision (بدون auth)
router.get ('/:id',           authenticate, v.getById);

// مسار التسجيل — 7 خطوات
router.post('/step1/request',          authenticate, authorize('REG_CHIEF'),  v.step1_submitRequest);
router.post('/step2/decision',         authenticate, authorize('ADMIN'),       v.step2_adminDecision);
router.post('/step3/send-to-inspection',authenticate,authorize('REG_CHIEF'),  v.step3_sendToInspection);
router.post('/step4/inspection',       authenticate, authorize('INSP_CHIEF'), v.step4_inspectionComplete);
router.post('/step5/generate-plate',   authenticate, authorize('REG_CHIEF'),  v.step5_generatePlate);
router.post('/step6/final-approval',   authenticate, authorize('ADMIN'),       v.step6_finalApproval);
router.post('/step7/issue-plate',      authenticate, authorize('PLATE_DEPT'), v.step7_issuePlate);

module.exports = router;
