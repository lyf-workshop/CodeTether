package org.codetether.app.ui

import androidx.lifecycle.AbstractSavedStateViewModelFactory
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import org.codetether.app.MainActivity

/** Debug-only dependency injection while exercising MainActivity's actual lifecycle. */
class MainActivityRegressionActivity : MainActivity() {
    override fun controllerFactory(): ViewModelProvider.Factory {
        val dependencies = requireNotNull(dependenciesForTest) { "Synthetic lifecycle dependencies are required" }
        return object : AbstractSavedStateViewModelFactory(this, null) {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(key: String, modelClass: Class<T>, handle: SavedStateHandle): T {
                check(modelClass == TabletController::class.java)
                return TabletController(application, dependencies, handle) as T
            }
        }
    }

    companion object {
        @Volatile internal var dependenciesForTest: ControllerDependencies? = null
    }
}
