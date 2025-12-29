// Keyboard Navigation Enhancements
// Improves keyboard accessibility throughout the app

export function initKeyboardNavigation() {
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Skip if user is typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    // Ctrl/Cmd + K - Quick task add (common shortcut)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const addTaskBtn = document.getElementById('addTaskBtn');
      if (addTaskBtn) {
        addTaskBtn.click();
        // Focus on the task name input if modal opens
        setTimeout(() => {
          const taskNameInput = document.getElementById('taskEditor_name');
          if (taskNameInput) {
            taskNameInput.focus();
          }
        }, 100);
      }
    }

    // Escape key - close modals
    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.modal:not(.hidden), .wizard-modal:not(.hidden), .settings-panel:not(.hidden)');
      modals.forEach(modal => {
        const closeBtn = modal.querySelector('[aria-label*="close" i], [title*="close" i], .btn-icon');
        if (closeBtn) {
          closeBtn.click();
        }
      });
    }
  });

  // Improve button keyboard navigation
  document.querySelectorAll('button, [role="button"]').forEach(button => {
    // Ensure buttons are keyboard accessible
    if (!button.hasAttribute('tabindex') && button.disabled !== true) {
      button.setAttribute('tabindex', '0');
    }

    // Add Enter/Space key support for buttons without native support
    button.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && button.getAttribute('role') === 'button') {
        e.preventDefault();
        button.click();
      }
    });
  });

  // Add arrow key navigation for lists
  document.querySelectorAll('[role="list"]').forEach(list => {
    const items = Array.from(list.querySelectorAll('[role="listitem"], button, a'));
    
    items.forEach((item, index) => {
      item.addEventListener('keydown', (e) => {
        let targetIndex = -1;
        
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          targetIndex = (index + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          targetIndex = (index - 1 + items.length) % items.length;
        } else if (e.key === 'Home') {
          e.preventDefault();
          targetIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          targetIndex = items.length - 1;
        }
        
        if (targetIndex >= 0) {
          items[targetIndex].focus();
        }
      });
    });
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKeyboardNavigation);
} else {
  initKeyboardNavigation();
}

