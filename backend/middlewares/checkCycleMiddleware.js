const db = require('../db');
const { detectCycle } = require('../services/cycleDetectorService');

async function checkCycleMiddleware(req, res, next) {
  const newDep = req.body;

  if (
    !newDep ||
    newDep.predecessor_task_id === undefined ||
    newDep.predecessor_task_id === null ||
    newDep.predecessor_task_id === '' ||
    newDep.successor_task_id === undefined ||
    newDep.successor_task_id === null ||
    newDep.successor_task_id === ''
  ) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_DEPENDENCY'
    });
  }

  if (!db.pool) {
    console.error('[T-24] Không thể kiểm tra chu trình: MySQL pool chưa sẵn sàng.');
    return res.status(503).json({
      success: false,
      error: 'DEPENDENCY_CHECK_UNAVAILABLE'
    });
  }

  let existingDeps;
  try {
    const [rows] = await db.pool.query(
      'SELECT predecessor_task_id, successor_task_id FROM dependencies'
    );
    existingDeps = rows;
  } catch (error) {
    console.error(
      '[T-24] Không thể đọc quan hệ phụ thuộc:',
      error.code || error.message || error
    );
    return res.status(503).json({
      success: false,
      error: 'DEPENDENCY_CHECK_UNAVAILABLE'
    });
  }

  const cycle = detectCycle(existingDeps, newDep);
  if (cycle) {
    return res.status(422).json({
      success: false,
      error: 'CYCLE_DETECTED',
      cycle
    });
  }

  return next();
}

module.exports = checkCycleMiddleware;
