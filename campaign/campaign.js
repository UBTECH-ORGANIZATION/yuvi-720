/* Lead form submission for the 720 campaign landing page. */
(function () {
  const form = document.getElementById('leadForm');
  if (!form) return;

  const submitButton = document.getElementById('leadSubmit');
  const statusEl = document.getElementById('leadStatus');
  const requiredFields = ['full_name', 'role', 'organization', 'city', 'phone', 'email'];
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const phonePattern = /^[0-9+()\-\s]{7,20}$/;

  window.dataLayer = window.dataLayer || [];

  // Scroll to the form without writing #lead into the URL: the form is the last
  // section, so a persisted hash makes every later load open at the bottom.
  document.querySelectorAll('[data-cta]').forEach((element) => {
    element.addEventListener('click', (event) => {
      window.dataLayer.push({ event: 'cta_click', cta_location: element.dataset.cta });

      const target = document.getElementById('lead');
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('cmp-status--error', Boolean(isError));
  }

  function markInvalid(field, invalid) {
    field.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  }

  function validate() {
    let firstInvalid = null;

    requiredFields.forEach((name) => {
      const field = form.elements[name];
      const value = field.value.trim();
      let invalid = value.length === 0;

      if (!invalid && name === 'email') invalid = !emailPattern.test(value);
      if (!invalid && name === 'phone') invalid = !phonePattern.test(value);

      markInvalid(field, invalid);
      if (invalid && !firstInvalid) firstInvalid = field;
    });

    return firstInvalid;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;

    const firstInvalid = validate();
    if (firstInvalid) {
      setStatus('נא למלא את כל שדות החובה בצורה תקינה.', true);
      firstInvalid.focus();
      return;
    }

    const payload = {
      full_name: form.elements.full_name.value.trim(),
      role: form.elements.role.value.trim(),
      organization: form.elements.organization.value.trim(),
      city: form.elements.city.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      grades: form.elements.grades.value.trim(),
      message: form.elements.message.value.trim(),
      company: form.elements.company.value.trim(),
      source: 'landing-720'
    };

    submitButton.disabled = true;
    setStatus('שולח...', false);

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('lead_submit_failed');

      window.dataLayer.push({ event: 'generate_lead', form_name: 'yuvi_spark_720_landing' });
      window.location.assign('/landing/thank-you');
    } catch (error) {
      submitButton.disabled = false;
      setStatus('אירעה תקלה בשליחה. אפשר לנסות שוב או לכתוב לנו למייל info@yuvilab.ai', true);
    }
  });
})();
