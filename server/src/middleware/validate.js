/**
 * Универсальная валидация req.body по декларативным правилам.
 * Пример: validate({ login: { required: true, type: 'string', min: 2, max: 64 } })
 */
export function validate(rules) {
  return function validateMiddleware(req, res, next) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : {};
    const errors = {};

    for (const [field, rule] of Object.entries(rules)) {
      const label = rule.label ?? field;
      const raw = body[field];
      const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

      if (missing) {
        if (rule.required) errors[field] = `${label}: обязательное поле`;
        continue;
      }

      if (rule.type) {
        const typeOk = rule.type === 'array' ? Array.isArray(raw) : typeof raw === rule.type;
        if (!typeOk) {
          errors[field] = `${label}: ожидается тип ${rule.type}`;
          continue;
        }
      }

      if (typeof raw === 'string') {
        const value = rule.trim === false ? raw : raw.trim();
        if (rule.min !== undefined && value.length < rule.min) {
          errors[field] = `${label}: не короче ${rule.min} символов`;
        } else if (rule.max !== undefined && value.length > rule.max) {
          errors[field] = `${label}: не длиннее ${rule.max} символов`;
        } else if (Array.isArray(rule.in) && !rule.in.includes(value)) {
          errors[field] = `${label}: допустимые значения — ${rule.in.join(', ')}`;
        } else {
          body[field] = value;
        }
        continue;
      }

      if (typeof raw === 'number' && rule.min !== undefined && raw < rule.min) {
        errors[field] = `${label}: минимум ${rule.min}`;
      } else if (typeof raw === 'number' && rule.max !== undefined && raw > rule.max) {
        errors[field] = `${label}: максимум ${rule.max}`;
      } else if (Array.isArray(raw) && rule.minLength !== undefined && raw.length < rule.minLength) {
        errors[field] = `${label}: не менее ${rule.minLength} элементов`;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ message: 'Ошибка валидации', errors });
    }

    req.body = body;
    return next();
  };
}
