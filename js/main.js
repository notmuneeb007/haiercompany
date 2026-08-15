/* ==========================================================================
   HAIRE — Main Scripts
   Mobile nav, scroll effects, FAQ accordion, reveal animations,
   animated counters, booking form validation, back-to-top.
   ========================================================================== */
(function () {
  'use strict';

  const header = document.getElementById('header');
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');
  const backToTop = document.getElementById('backToTop');

  /* ---------- Mobile navigation ---------- */
  function toggleMenu(force) {
    const isOpen = typeof force === 'boolean' ? force : !navMenu.classList.contains('open');
    navMenu.classList.toggle('open', isOpen);
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  navToggle.addEventListener('click', function () {
    toggleMenu();
  });

  /* ---------- Logout ---------- */
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function (event) {
      event.preventDefault();
      fetch('/api/logout', { method: 'POST' })
        .then(function () {
          window.location.href = '/login.html';
        })
        .catch(function () {
          window.location.href = '/login.html';
        });
    });
  }

  navMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      if (navMenu.classList.contains('open')) toggleMenu(false);
    });
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768 && navMenu.classList.contains('open')) {
      toggleMenu(false);
    }
  });

  /* ---------- Header shadow on scroll + back to top ---------- */
  function onScroll() {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    if (window.scrollY > 480) {
      backToTop.classList.add('show');
    } else {
      backToTop.classList.remove('show');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  backToTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------- Active nav link highlighting ---------- */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav__link');

  const sectionObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach(function (link) {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );

  sections.forEach(function (section) {
    sectionObserver.observe(section);
  });

  /* ---------- Scroll reveal animations ---------- */
  const revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ---------- FAQ accordion ---------- */
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(function (item) {
    const question = item.querySelector('.faq-item__question');
    const answer = item.querySelector('.faq-item__answer');

    question.addEventListener('click', function () {
      const isOpen = item.classList.contains('open');

      faqItems.forEach(function (other) {
        other.classList.remove('open');
        other.querySelector('.faq-item__answer').style.maxHeight = '0px';
        other.querySelector('.faq-item__question').setAttribute('aria-expanded', 'false');
      });

      if (!isOpen) {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        question.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Animated counters (stats) ---------- */
  const counters = document.querySelectorAll('.stat__num');

  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-count'), 10);
    const suffix = el.getAttribute('data-suffix') || '';
    const duration = 1800;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target) + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );

    counters.forEach(function (counter) {
      counterObserver.observe(counter);
    });
  } else {
    counters.forEach(function (counter) {
      counter.textContent = counter.getAttribute('data-count') + (counter.getAttribute('data-suffix') || '');
    });
  }

  /* ---------- Booking form validation ---------- */
  const bookingForm = document.getElementById('bookingForm');
  const formSuccess = document.getElementById('formSuccess');

  function setError(input, message) {
    const group = input.closest('.form-group');
    const errorEl = group.querySelector('.form-error');
    if (message) {
      group.classList.add('is-error');
      errorEl.textContent = message;
    } else {
      group.classList.remove('is-error');
      errorEl.textContent = '';
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function isValidPhone(value) {
    return /^[+\d][\d\s\-()]{6,}$/.test(value);
  }

  function validateField(input) {
    const name = input.name;
    const value = input.value.trim();
    let message = '';

    if (!value) {
      message = 'This field is required.';
    } else if (name === 'email' && !isValidEmail(value)) {
      message = 'Please enter a valid email address.';
    } else if (name === 'phone' && !isValidPhone(value)) {
      message = 'Please enter a valid phone number.';
    }

    setError(input, message);
    return !message;
  }

  bookingForm.addEventListener('submit', function (event) {
    event.preventDefault();

    fetch('/api/me')
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.user) {
          handleBookingSubmit();
        } else {
          window.location.href = '/login.html?next=/#booking';
        }
      })
      .catch(function () {
        window.location.href = '/login.html?next=/#booking';
      });
  });

  function handleBookingSubmit() {
    const inputs = bookingForm.querySelectorAll('input, select, textarea');
    let valid = true;

    inputs.forEach(function (input) {
      if (input.name === 'message') return;
      if (!validateField(input)) {
        valid = false;
      }
    });

    if (!valid) {
      const firstError = bookingForm.querySelector('.is-error');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const submitBtn = bookingForm.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const formData = {};
    inputs.forEach(function (input) {
      formData[input.name] = input.value.trim();
    });

    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          formSuccess.textContent = 'Thank you! Your booking request has been received. Our team will confirm shortly.';
          formSuccess.classList.add('show');
          bookingForm.reset();
        } else {
          formSuccess.textContent = result.data.message || 'Something went wrong. Please try again or call us.';
          formSuccess.classList.add('show');
          formSuccess.classList.add('is-error');
        }
        setTimeout(function () {
          formSuccess.classList.remove('show', 'is-error');
          formSuccess.textContent = '';
        }, 7000);
      })
      .catch(function () {
        formSuccess.textContent = 'Network error. Please check your connection and try again.';
        formSuccess.classList.add('show');
        formSuccess.classList.add('is-error');
        setTimeout(function () {
          formSuccess.classList.remove('show', 'is-error');
          formSuccess.textContent = '';
        }, 7000);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      });
  }

  bookingForm.querySelectorAll('input, select, textarea').forEach(function (input) {
    input.addEventListener('blur', function () {
      if (input.name !== 'message') validateField(input);
    });
    input.addEventListener('input', function () {
      const group = input.closest('.form-group');
      if (group && group.classList.contains('is-error')) {
        validateField(input);
      }
    });
  });

  /* ---------- Set minimum booking date to today ---------- */
  const dateInput = document.getElementById('date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.setAttribute('min', today);
  }
})();
