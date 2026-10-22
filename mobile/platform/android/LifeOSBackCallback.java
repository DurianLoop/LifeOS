package life.lifeos.nativebridge;

import androidx.activity.OnBackPressedCallback;

/** Delegate Android's system/predictive back action into the Python UI loop. */
public final class LifeOSBackCallback extends OnBackPressedCallback {
    private final Runnable action;

    public LifeOSBackCallback(Runnable action) {
        super(true);
        this.action = action;
    }

    @Override public void handleOnBackPressed() {
        action.run();
    }
}
